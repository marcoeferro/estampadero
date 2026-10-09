import "server-only";

import { TRPCError } from "@trpc/server";
import type { Prisma } from "generated/prisma";
import { z } from "zod";

import {
  adminMutationRateLimit,
  adminProcedure,
  createTRPCRouter,
  publicProcedure,
} from "elestampadero/server/api/trpc";
import { db } from "elestampadero/server/db";

import { voucherTypeLabel } from "../domain/voucher-rules";
// Import directo para evitar el ciclo index → router → index.
import { invoicingService } from "../service";

const voucherStatusSchema = z.enum([
  "PENDING",
  "PROCESSING",
  "AWAITING_AUTHORIZATION",
  "ISSUED",
  "FAILED",
]);

function toVoucherDto(
  voucher: Prisma.FiscalVoucherGetPayload<{
    include: { order: { select: { orderNumber: true; contactName: true } } };
  }>,
) {
  return {
    id: voucher.id,
    orderId: voucher.orderId,
    orderNumber: voucher.order.orderNumber,
    customerName: voucher.order.contactName,
    kind: voucher.kind,
    voucherType: voucher.voucherType,
    label: voucherTypeLabel(voucher.voucherType),
    status: voucher.status,
    amountInCents: voucher.amountInCents,
    buyerDocType: voucher.buyerDocType,
    buyerDocNumber: voucher.buyerDocNumber,
    buyerName: voucher.buyerName,
    pointOfSale: voucher.pointOfSale,
    number: voucher.number,
    cae: voucher.cae,
    caeExpiresAt: voucher.caeExpiresAt?.toISOString() ?? null,
    issuedAt: voucher.issuedAt?.toISOString() ?? null,
    provider: voucher.provider,
    errorMessage: voucher.errorMessage,
    attempts: voucher.attempts,
    nextAttemptAt: voucher.nextAttemptAt.toISOString(),
    createdAt: voucher.createdAt.toISOString(),
    downloadUrl:
      voucher.status === "ISSUED" ? `/api/comprobantes/${voucher.id}` : null,
  };
}

const voucherInclude = {
  order: { select: { orderNumber: true, contactName: true } },
} satisfies Prisma.FiscalVoucherInclude;

export const invoicingRouter = createTRPCRouter({
  /** Comprobantes emitidos de un pedido, para la página del pedido. */
  forOrder: publicProcedure
    .input(z.object({ orderId: z.string().min(1).max(60) }))
    .query(async ({ input }) => {
      const vouchers = await db.fiscalVoucher.findMany({
        where: { orderId: input.orderId, status: "ISSUED" },
        include: voucherInclude,
        orderBy: { createdAt: "asc" },
      });
      return vouchers.map((voucher) => {
        const dto = toVoucherDto(voucher);
        return {
          id: dto.id,
          label: dto.label,
          pointOfSale: dto.pointOfSale,
          number: dto.number,
          amountInCents: dto.amountInCents,
          issuedAt: dto.issuedAt,
          downloadUrl: dto.downloadUrl,
        };
      });
    }),

  adminForOrder: adminProcedure
    .input(z.object({ orderId: z.string().min(1).max(60) }))
    .query(async ({ input }) => {
      const vouchers = await db.fiscalVoucher.findMany({
        where: { orderId: input.orderId },
        include: voucherInclude,
        orderBy: { createdAt: "asc" },
      });
      return {
        enabled: invoicingService.isEnabled,
        vouchers: vouchers.map(toVoucherDto),
      };
    }),

  adminList: adminProcedure
    .input(
      z.object({
        status: voucherStatusSchema.optional(),
        kind: z.enum(["INVOICE", "CREDIT_NOTE"]).optional(),
        from: z.string().date().optional(),
        to: z.string().date().optional(),
        search: z.string().trim().max(80).optional(),
        page: z.number().int().min(1).max(10_000).default(1),
      }),
    )
    .query(async ({ input }) => {
      const pageSize = 25;
      const searchNumber = Number(input.search);
      const where: Prisma.FiscalVoucherWhereInput = {
        ...(input.status ? { status: input.status } : {}),
        ...(input.kind ? { kind: input.kind } : {}),
        ...(input.from || input.to
          ? {
              createdAt: {
                ...(input.from
                  ? { gte: new Date(`${input.from}T00:00:00-03:00`) }
                  : {}),
                ...(input.to
                  ? { lte: new Date(`${input.to}T23:59:59-03:00`) }
                  : {}),
              },
            }
          : {}),
        ...(input.search
          ? {
              OR: [
                { buyerName: { contains: input.search, mode: "insensitive" } },
                { buyerDocNumber: { contains: input.search } },
                { cae: { contains: input.search } },
                ...(Number.isInteger(searchNumber)
                  ? [
                      { number: searchNumber },
                      { order: { orderNumber: searchNumber } },
                    ]
                  : []),
              ],
            }
          : {}),
      };
      const [total, vouchers, counts] = await Promise.all([
        db.fiscalVoucher.count({ where }),
        db.fiscalVoucher.findMany({
          where,
          include: voucherInclude,
          orderBy: { createdAt: "desc" },
          skip: (input.page - 1) * pageSize,
          take: pageSize,
        }),
        db.fiscalVoucher.groupBy({ by: ["status"], _count: { _all: true } }),
      ]);
      return {
        enabled: invoicingService.isEnabled,
        total,
        pageSize,
        vouchers: vouchers.map(toVoucherDto),
        countsByStatus: Object.fromEntries(
          counts.map((count) => [count.status, count._count._all]),
        ),
      };
    }),

  retry: adminProcedure
    .input(z.object({ voucherId: z.string().min(1).max(60) }))
    .use(adminMutationRateLimit("invoicing.retry", { limit: 30 }))
    .mutation(async ({ input }) => {
      if (!invoicingService.isEnabled) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "La facturación electrónica no está activada.",
        });
      }
      const voucher = await invoicingService.retryVoucher(input.voucherId);
      if (!voucher) throw new TRPCError({ code: "NOT_FOUND" });
      return { status: voucher.status, errorMessage: voucher.errorMessage };
    }),

  issueForOrder: adminProcedure
    .input(z.object({ orderId: z.string().min(1).max(60) }))
    .use(adminMutationRateLimit("invoicing.issueForOrder", { limit: 30 }))
    .mutation(async ({ input }) => {
      if (!invoicingService.isEnabled) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "La facturación electrónica no está activada.",
        });
      }
      const voucher = await invoicingService.requestInvoice(input.orderId);
      if (!voucher) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Solo se facturan pedidos con el pago aprobado.",
        });
      }
      return { status: voucher.status, errorMessage: voucher.errorMessage };
    }),
});
