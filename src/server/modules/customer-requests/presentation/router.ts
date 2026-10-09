import "server-only";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  adminMutationRateLimit,
  adminProcedure,
  createTRPCRouter,
  getClientIp,
  publicProcedure,
  rateLimit,
} from "elestampadero/server/api/trpc";
import { db } from "elestampadero/server/db";
import { refundAdjustmentSchedule } from "elestampadero/server/modules/commissions";
import { mercadoPagoGateway } from "elestampadero/server/modules/payments/infrastructure/providers/mercado-pago-gateway";
import { modoGateway } from "elestampadero/server/modules/payments/infrastructure/providers/modo-gateway";
import { mobbexGateway } from "elestampadero/server/modules/payments/infrastructure/providers/mobbex-gateway";
import { paywayGateway } from "elestampadero/server/modules/payments/infrastructure/providers/payway-gateway";
import type { PaymentGateway } from "elestampadero/server/modules/payments/application/ports/payment-gateway";

const lookupSchema = z.object({
  orderNumber: z.coerce.number().int().positive(),
  email: z
    .string()
    .email()
    .max(254)
    .transform((value) => value.trim().toLowerCase()),
});

const createSchema = lookupSchema.extend({
  type: z.enum(["WITHDRAWAL", "RETURN", "CLAIM"]),
  reason: z.string().trim().min(3).max(180),
  details: z.string().trim().max(2000).optional(),
  items: z
    .array(
      z.object({
        orderItemId: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(30),
});

const requestInclude = {
  order: {
    select: { orderNumber: true, contactName: true, deliveredAt: true },
  },
  payment: {
    select: {
      status: true,
      paymentMethodType: true,
      paymentMethodId: true,
      installments: true,
      amountInCents: true,
      amountRefundedInCents: true,
    },
  },
  items: {
    include: {
      orderItem: {
        select: {
          productName: true,
          size: true,
          color: true,
          clubNameSnapshot: true,
        },
      },
    },
  },
} as const;

async function findVerifiedOrder(input: z.infer<typeof lookupSchema>) {
  const order = await db.order.findFirst({
    where: {
      orderNumber: input.orderNumber,
      contactEmail: { equals: input.email, mode: "insensitive" },
    },
    include: {
      items: true,
      payments: {
        where: {
          status: { in: ["APPROVED", "PARTIALLY_REFUNDED", "REFUNDED"] },
        },
        orderBy: { approvedAt: "desc" },
        take: 1,
      },
    },
  });
  if (!order) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "No encontramos un pedido con ese número y correo.",
    });
  }
  return order;
}

export const customerRequestsRouter = createTRPCRouter({
  lookupOrder: publicProcedure
    .input(lookupSchema)
    .use(
      rateLimit<z.infer<typeof lookupSchema>>({
        limit: 8,
        windowMs: 15 * 60_000,
        key: ({ ctx }) => `customer-request-lookup:${getClientIp(ctx.headers)}`,
      }),
    )
    .query(async ({ input }) => {
      const order = await findVerifiedOrder(input);
      const payment = order.payments[0] ?? null;
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        deliveredAt: order.deliveredAt,
        paymentStatus: payment?.status ?? null,
        items: order.items.map((item) => ({
          id: item.id,
          productName: item.productName,
          size: item.size,
          color: item.color,
          imageUrl: item.imageUrl,
          quantity: item.quantity,
          unitAmountInCents: item.priceInCentsSnapshot,
          lineAmountInCents: item.lineTotalInCents,
          clubName: item.clubNameSnapshot,
        })),
      };
    }),

  create: publicProcedure
    .input(createSchema)
    .use(
      rateLimit<z.infer<typeof createSchema>>({
        limit: 4,
        windowMs: 30 * 60_000,
        key: ({ ctx, input }) =>
          `customer-request-create:${input.orderNumber}:${getClientIp(ctx.headers)}`,
      }),
    )
    .mutation(async ({ input }) => {
      const order = await findVerifiedOrder(input);
      const itemById = new Map(order.items.map((item) => [item.id, item]));
      const reservedQuantities = await db.customerRequestItem.groupBy({
        by: ["orderItemId"],
        where: {
          orderItemId: { in: input.items.map((item) => item.orderItemId) },
          request: {
            status: {
              in: [
                "REQUESTED",
                "UNDER_REVIEW",
                "APPROVED",
                "REFUND_PROCESSING",
                "REFUNDED",
              ],
            },
          },
        },
        _sum: { quantity: true },
      });
      const reservedByItem = new Map(
        reservedQuantities.map((item) => [
          item.orderItemId,
          item._sum.quantity ?? 0,
        ]),
      );
      const uniqueIds = new Set(input.items.map((item) => item.orderItemId));
      if (uniqueIds.size !== input.items.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Hay prendas repetidas.",
        });
      }

      const requestedItems = input.items.map((selected) => {
        const item = itemById.get(selected.orderItemId);
        const availableQuantity = item
          ? item.quantity - (reservedByItem.get(item.id) ?? 0)
          : 0;
        if (!item || selected.quantity > availableQuantity) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "La cantidad solicitada no está disponible o ya forma parte de otra solicitud.",
          });
        }
        return {
          orderItemId: item.id,
          quantity: selected.quantity,
          unitAmountInCents: item.priceInCentsSnapshot,
          lineAmountInCents: item.priceInCentsSnapshot * selected.quantity,
        };
      });
      const requestedRefundInCents = requestedItems.reduce(
        (total, item) => total + item.lineAmountInCents,
        0,
      );
      const returnWindowDays =
        (
          await db.siteContentSetting.findUnique({
            where: { id: "home" },
            select: { returnWindowDays: true },
          })
        )?.returnWindowDays ?? 10;
      const returnDeadline = order.deliveredAt
        ? new Date(order.deliveredAt.getTime() + returnWindowDays * 86_400_000)
        : null;

      const request = await db.customerRequest.create({
        data: {
          type: input.type,
          orderId: order.id,
          paymentId: order.payments[0]?.id,
          customerEmail: input.email,
          reason: input.reason,
          details: input.details?.length ? input.details : null,
          requestedRefundInCents,
          eligibilitySnapshot: {
            orderStatus: order.status,
            deliveredAt: order.deliveredAt?.toISOString() ?? null,
            returnWindowDays,
            returnDeadline: returnDeadline?.toISOString() ?? null,
            insideReturnWindow: returnDeadline
              ? returnDeadline >= new Date()
              : null,
          },
          items: { create: requestedItems },
        },
        select: { publicCode: true },
      });
      return request;
    }),

  list: adminProcedure.query(() =>
    db.customerRequest.findMany({
      include: requestInclude,
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ),

  reject: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        note: z.string().trim().min(3).max(1000),
      }),
    )
    .use(adminMutationRateLimit("customerRequests.reject"))
    .mutation(({ ctx, input }) =>
      db.customerRequest.update({
        where: { id: input.id, status: { in: ["REQUESTED", "UNDER_REVIEW"] } },
        data: {
          status: "REJECTED",
          reviewNote: input.note,
          reviewedByUserId: ctx.session.user.id,
          reviewedAt: new Date(),
        },
      }),
    ),

  approveRefund: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        amountInCents: z.number().int().positive(),
        note: z.string().trim().max(1000).optional(),
      }),
    )
    .use(
      adminMutationRateLimit("customerRequests.approveRefund", { limit: 10 }),
    )
    .mutation(async ({ ctx, input }) => {
      const request = await db.customerRequest.findUnique({
        where: { id: input.id },
        include: { payment: true, items: true },
      });
      if (!request?.payment?.providerPaymentId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "El pedido no tiene un pago reembolsable.",
        });
      }
      const payment = request.payment;
      if (
        !["REQUESTED", "UNDER_REVIEW", "REFUND_PROCESSING"].includes(
          request.status,
        )
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "La solicitud ya fue resuelta.",
        });
      }
      const gateways: Partial<Record<string, PaymentGateway>> = {
        MOBBEX: mobbexGateway,
        MERCADO_PAGO: mercadoPagoGateway,
        PAYWAY: paywayGateway,
        MODO: modoGateway,
      };
      const gateway = gateways[payment.provider];
      if (!gateway?.refundPayment) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Este medio de pago no admite devolución automática.",
        });
      }
      if (input.amountInCents > request.requestedRefundInCents) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El importe supera lo solicitado.",
        });
      }
      const remaining = payment.amountInCents - payment.amountRefundedInCents;
      if (input.amountInCents > remaining) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El importe supera el saldo reembolsable.",
        });
      }
      const isVisaDebit =
        payment.paymentMethodId === "31" ||
        (payment.paymentMethodType === "debit_card" &&
          payment.paymentMethodId?.toLowerCase().includes("visa"));
      if (isVisaDebit && input.amountInCents < remaining) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Payway no admite devoluciones parciales para Visa Débito. Debe reintegrarse el saldo total del pago.",
        });
      }

      const idempotencyKey =
        request.refundIdempotencyKey ?? `refund:${request.id}`;
      await db.customerRequest.update({
        where: { id: request.id },
        data: {
          status: "REFUND_PROCESSING",
          approvedRefundInCents: input.amountInCents,
          refundIdempotencyKey: idempotencyKey,
          reviewNote: input.note?.length ? input.note : null,
          reviewedByUserId: ctx.session.user.id,
          reviewedAt: new Date(),
        },
      });

      let refund;
      try {
        refund = await gateway.refundPayment({
          providerPaymentId: payment.providerPaymentId!,
          amountInCents: input.amountInCents,
          idempotencyKey,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message:
            error instanceof Error
              ? error.message
              : "La pasarela no pudo procesar la devolución.",
        });
      }

      const ratio = input.amountInCents / request.requestedRefundInCents;
      const now = new Date();
      await db.$transaction(async (tx) => {
        for (const item of request.items) {
          const sale = await tx.commissionEntry.findFirst({
            where: { orderItemId: item.orderItemId, entryType: "SALE" },
          });
          if (!sale) continue;
          const itemRefund = Math.round(item.lineAmountInCents * ratio);
          const adjustment = -Math.round(
            (itemRefund * sale.percentageApplied) / 100,
          );
          const schedule = refundAdjustmentSchedule({
            provider: payment.provider,
            sale,
            now,
          });
          await tx.commissionEntry.upsert({
            where: { sourceKey: `refund:${request.id}:${item.id}` },
            update: {},
            create: {
              clubId: sale.clubId,
              agreementId: sale.agreementId,
              orderId: sale.orderId,
              orderItemId: sale.orderItemId,
              paymentId: sale.paymentId,
              orderNumber: sale.orderNumber,
              productName: `Ajuste devolución · ${sale.productName}`,
              entryType: "REFUND_ADJUSTMENT",
              sourceKey: `refund:${request.id}:${item.id}`,
              baseAmountInCents: -itemRefund,
              percentageApplied: sale.percentageApplied,
              amountInCents: adjustment,
              status: schedule.status,
              releasedAt: schedule.releasedAt,
              returnWindowEndsAt: sale.returnWindowEndsAt,
              availableAt: schedule.availableAt,
            },
          });
        }

        const refundedTotal =
          payment.amountRefundedInCents + input.amountInCents;
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            amountRefundedInCents: refundedTotal,
            status:
              refundedTotal >= payment.amountInCents
                ? "REFUNDED"
                : "PARTIALLY_REFUNDED",
          },
        });
        await tx.customerRequest.update({
          where: { id: request.id },
          data: {
            status: "REFUNDED",
            providerRefundId: refund.providerRefundId,
            providerRefundStatus: refund.providerStatus,
            refundedAt: new Date(),
          },
        });
      });

      return db.customerRequest.findUnique({
        where: { id: request.id },
        include: requestInclude,
      });
    }),
});
