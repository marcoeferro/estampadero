import "server-only";

import { TRPCError } from "@trpc/server";
import type { Prisma } from "generated/prisma";

import { db } from "elestampadero/server/db";

import type { OrderDetailDto } from "../../application/dto/order-detail";
import type {
  OrderMetricsDto,
  OrderSummaryDto,
} from "../../application/dto/order-summary";
import type {
  CreateOrderInput,
  CreateExternalOrderInput,
  OrdersRepository,
  OrderStatusValue,
} from "../../application/ports/orders-repository";

function toDto(order: {
  id: string;
  orderNumber: number;
  status: string;
  contactName: string;
  customerDocument: string | null;
  contactEmail: string;
  contactPhone: string;
  deliveryMethod: string;
  shippingAddress: string | null;
  shippingCity: string | null;
  shippingPostalCode: string | null;
  subtotalInCents: number;
  shippingInCents: number;
  totalInCents: number;
  createdAt: Date;
  receiptEmailSentAt: Date | null;
  deliveredAt: Date | null;
  payments: {
    id: string;
    status: string;
    channel: string;
    provider: string;
    amountInCents: number;
    paymentMethodType: string | null;
    paymentMethodId: string | null;
    installments: number | null;
    moneyReleaseDate: Date | null;
    moneyReleasedAt: Date | null;
    netReceivedInCents: number | null;
    feeInCents: number | null;
    financingFeeInCents: number | null;
    amountRefundedInCents: number;
    lastProviderRefundId: string | null;
  }[];
  items: {
    id: string;
    productId: string;
    productName: string;
    productSlug: string;
    size: string;
    color: string;
    imageUrl: string | null;
    priceInCentsSnapshot: number;
    quantity: number;
    lineTotalInCents: number;
    clubId: string | null;
    clubNameSnapshot: string | null;
    clubAgreementId: string | null;
    clubSharePercentage: number | null;
  }[];
}): OrderDetailDto {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    contactName: order.contactName,
    customerDocument: order.customerDocument,
    contactEmail: order.contactEmail,
    contactPhone: order.contactPhone,
    deliveryMethod: order.deliveryMethod,
    shippingAddress: order.shippingAddress,
    shippingCity: order.shippingCity,
    shippingPostalCode: order.shippingPostalCode,
    subtotalInCents: order.subtotalInCents,
    shippingInCents: order.shippingInCents,
    totalInCents: order.totalInCents,
    createdAt: order.createdAt.toISOString(),
    receiptEmailSentAt: order.receiptEmailSentAt?.toISOString() ?? null,
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
    payment: order.payments[0]
      ? {
          ...order.payments[0],
          moneyReleaseDate:
            order.payments[0].moneyReleaseDate?.toISOString() ?? null,
          moneyReleasedAt:
            order.payments[0].moneyReleasedAt?.toISOString() ?? null,
        }
      : null,
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      productSlug: item.productSlug,
      size: item.size,
      color: item.color,
      imageUrl: item.imageUrl,
      priceInCentsSnapshot: item.priceInCentsSnapshot,
      quantity: item.quantity,
      lineTotalInCents: item.lineTotalInCents,
      clubId: item.clubId,
      clubNameSnapshot: item.clubNameSnapshot,
      clubAgreementId: item.clubAgreementId,
      clubSharePercentage: item.clubSharePercentage,
    })),
  };
}

const orderInclude = {
  items: true,
  payments: {
    orderBy: { updatedAt: "desc" },
    take: 1,
    select: {
      id: true,
      status: true,
      channel: true,
      provider: true,
      amountInCents: true,
      paymentMethodType: true,
      paymentMethodId: true,
      installments: true,
      moneyReleaseDate: true,
      moneyReleasedAt: true,
      netReceivedInCents: true,
      feeInCents: true,
      financingFeeInCents: true,
      amountRefundedInCents: true,
      lastProviderRefundId: true,
    },
  },
} as const;

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

type DashboardPeriod = "day" | "week" | "month" | "year";

const BILLABLE_STATUSES = [
  "PAID",
  "IN_PRODUCTION",
  "READY_FOR_SHIPPING",
  "SHIPPED",
  "DELIVERED",
] as const;

function getPeriodRange(period: DashboardPeriod, now = new Date()) {
  let start: Date;
  let end: Date;
  let previousStart: Date;

  if (period === "day") {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    end = new Date(start);
    end.setDate(end.getDate() + 1);
    previousStart = new Date(start);
    previousStart.setDate(previousStart.getDate() - 1);
  } else if (period === "week") {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const mondayOffset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - mondayOffset);
    end = new Date(start);
    end.setDate(end.getDate() + 7);
    previousStart = new Date(start);
    previousStart.setDate(previousStart.getDate() - 7);
  } else if (period === "year") {
    start = new Date(now.getFullYear(), 0, 1);
    end = new Date(now.getFullYear() + 1, 0, 1);
    previousStart = new Date(now.getFullYear() - 1, 0, 1);
  } else {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  }

  return { start, end, previousStart };
}

function percentageChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function buildSalesSeries(
  period: DashboardPeriod,
  start: Date,
  orders: { createdAt: Date; totalInCents: number }[],
) {
  const bucketCount =
    period === "day"
      ? 6
      : period === "week"
        ? 7
        : period === "year"
          ? 12
          : new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate() <=
              28
            ? 4
            : 5;
  const monthLabels = [
    "Ene",
    "Feb",
    "Mar",
    "Abr",
    "May",
    "Jun",
    "Jul",
    "Ago",
    "Sep",
    "Oct",
    "Nov",
    "Dic",
  ];
  const weekLabels = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    label:
      period === "day"
        ? `${String(index * 4).padStart(2, "0")}h`
        : period === "week"
          ? weekLabels[index]!
          : period === "year"
            ? monthLabels[index]!
            : `S${index + 1}`,
    amountInCents: 0,
    orderCount: 0,
  }));

  for (const order of orders) {
    const bucketIndex =
      period === "day"
        ? Math.floor(order.createdAt.getHours() / 4)
        : period === "week"
          ? (order.createdAt.getDay() + 6) % 7
          : period === "year"
            ? order.createdAt.getMonth()
            : Math.min(
                bucketCount - 1,
                Math.floor((order.createdAt.getDate() - 1) / 7),
              );
    const bucket = buckets[bucketIndex];
    if (!bucket) continue;
    bucket.amountInCents += order.totalInCents;
    bucket.orderCount += 1;
  }

  return buckets;
}

export const prismaOrdersRepository: OrdersRepository = {
  async createOrder(input: CreateOrderInput): Promise<OrderDetailDto> {
    try {
      const order = await db.$transaction(async (tx) => {
        const reservedVariantIds = new Set<string>();
        const requestedStock = new Map<string, number>();
        for (const item of input.items) {
          if (!item.stockControlled) continue;
          requestedStock.set(
            item.variantId,
            (requestedStock.get(item.variantId) ?? 0) + item.quantity,
          );
        }

        for (const [variantId, quantity] of requestedStock) {
          const result = await tx.productVariant.updateMany({
            where: { id: variantId, stock: { gte: quantity } },
            data: { stock: { decrement: quantity } },
          });
          if (result.count === 0) {
            const item = input.items.find(
              (candidate) => candidate.variantId === variantId,
            );
            throw new TRPCError({
              code: "CONFLICT",
              message: item
                ? `Sin stock suficiente para ${item.productName} (talle ${item.size}, color ${item.color}).`
                : "Uno de los productos ya no tiene stock suficiente.",
            });
          }
          reservedVariantIds.add(variantId);
        }

        return tx.order.create({
          data: {
            checkoutRequestId: input.checkoutRequestId,
            userId: input.userId,
            contactName: input.contactName,
            customerDocument: input.customerDocument ?? null,
            contactEmail: input.contactEmail,
            contactPhone: input.contactPhone,
            deliveryMethod: input.deliveryMethod,
            shippingAddress: input.shippingAddress,
            shippingCity: input.shippingCity,
            shippingPostalCode: input.shippingPostalCode,
            subtotalInCents: input.subtotalInCents,
            shippingInCents: input.shippingInCents,
            totalInCents: input.totalInCents,
            items: {
              create: input.items.map((item) => ({
                productId: item.productId,
                productName: item.productName,
                productSlug: item.productSlug,
                variantId: item.variantId,
                size: item.size,
                color: item.color,
                imageUrl: item.imageUrl,
                priceInCentsSnapshot: item.priceInCentsSnapshot,
                quantity: item.quantity,
                lineTotalInCents: item.lineTotalInCents,
                stockReserved: reservedVariantIds.has(item.variantId),
                clubId: item.clubId,
                clubNameSnapshot: item.clubNameSnapshot,
                clubAgreementId: item.clubAgreementId ?? null,
                clubSharePercentage: item.clubSharePercentage ?? null,
              })),
            },
            statusHistory: {
              create: { status: "PENDING_PAYMENT", note: "Pedido creado" },
            },
          },
          include: orderInclude,
        });
      });

      return toDto(order);
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;

      const existing = await db.order.findUnique({
        where: { checkoutRequestId: input.checkoutRequestId },
        include: orderInclude,
      });
      if (!existing) throw error;
      return toDto(existing);
    }
  },

  async createExternalOrder(
    input: CreateExternalOrderInput,
  ): Promise<OrderDetailDto> {
    const order = await db.$transaction(async (tx) => {
      const variants = await tx.productVariant.findMany({
        where: { id: { in: input.items.map((item) => item.variantId) } },
        include: {
          product: {
            include: { images: { orderBy: { position: "asc" }, take: 1 } },
          },
        },
      });
      const variantById = new Map(
        variants.map((variant) => [variant.id, variant]),
      );
      const items = input.items.map((inputItem) => {
        const variant = variantById.get(inputItem.variantId);
        if (!variant)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Una variante no existe.",
          });
        const lineTotalInCents =
          variant.product.priceInCents * inputItem.quantity;
        return {
          productId: variant.productId,
          productName: variant.product.name,
          productSlug: variant.product.slug,
          variantId: variant.id,
          size: variant.size,
          color: variant.color,
          imageUrl: variant.product.images[0]?.url ?? null,
          priceInCentsSnapshot: variant.product.priceInCents,
          quantity: inputItem.quantity,
          lineTotalInCents,
          clubId: variant.product.clubId,
          clubNameSnapshot: null,
        };
      });
      const subtotalInCents = items.reduce(
        (sum, item) => sum + item.lineTotalInCents,
        0,
      );
      const created = await tx.order.create({
        data: {
          contactName: input.contactName,
          customerDocument: input.customerDocument ?? null,
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone,
          deliveryMethod: input.deliveryMethod,
          shippingAddress: input.shippingAddress,
          shippingCity: input.shippingCity,
          shippingPostalCode: input.shippingPostalCode,
          subtotalInCents,
          shippingInCents: 0,
          totalInCents: subtotalInCents,
          status: "PAID",
          items: { create: items },
          statusHistory: {
            create: {
              status: "PAID",
              note: "Pedido externo cargado por administración y pendiente de producción",
            },
          },
        },
        include: orderInclude,
      });
      return created;
    });
    return toDto(order);
  },

  async expireUnpaidOrders({
    createdBefore,
    paymentActivityBefore,
    limit,
  }): Promise<number> {
    const candidates = await db.order.findMany({
      where: {
        status: "PENDING_PAYMENT",
        stockReleasedAt: null,
        createdAt: { lt: createdBefore },
      },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: { id: true },
    });
    let expired = 0;

    for (const candidate of candidates) {
      const didExpire = await db.$transaction(async (tx) => {


        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${candidate.id}))`;

        const protectedPayment = await tx.payment.count({
          where: {
            orderId: candidate.id,
            OR: [
              {
                status: { in: ["APPROVED", "PARTIALLY_REFUNDED", "REFUNDED"] },
              },
              {
                status: { in: ["CREATED", "PENDING", "PROCESSING"] },
                updatedAt: { gte: paymentActivityBefore },
              },
            ],
          },
        });
        if (protectedPayment > 0) return false;

        const claimed = await tx.order.updateMany({
          where: {
            id: candidate.id,
            status: "PENDING_PAYMENT",
            stockReleasedAt: null,
          },
          data: { status: "CANCELLED", stockReleasedAt: new Date() },
        });
        if (claimed.count === 0) return false;

        const reserved = await tx.orderItem.groupBy({
          by: ["variantId"],
          where: { orderId: candidate.id, stockReserved: true },
          _sum: { quantity: true },
        });
        for (const item of reserved) {
          const quantity = item._sum.quantity ?? 0;
          if (quantity > 0) {
            await tx.productVariant.updateMany({
              where: { id: item.variantId },
              data: { stock: { increment: quantity } },
            });
          }
        }

        await tx.orderItem.updateMany({
          where: { orderId: candidate.id, stockReserved: true },
          data: { stockReserved: false },
        });
        await tx.payment.updateMany({
          where: {
            orderId: candidate.id,
            status: { in: ["CREATED", "PENDING", "PROCESSING"] },
          },
          data: { status: "EXPIRED", providerStatus: "order_expired" },
        });
        await tx.orderStatusHistory.create({
          data: {
            orderId: candidate.id,
            status: "CANCELLED",
            note: "Pedido vencido sin pago confirmado; stock liberado",
          },
        });
        return true;
      });

      if (didExpire) expired += 1;
    }

    return expired;
  },

  async getOrderById(id: string): Promise<OrderDetailDto | null> {
    const order = await db.order.findUnique({
      where: { id },
      include: orderInclude,
    });
    return order ? toDto(order) : null;
  },

  async listOrders(filters): Promise<OrderSummaryDto[]> {
    const search = filters.search?.trim();
    const searchOrderNumber =
      search && /^#?\d+$/.test(search)
        ? Number(search.replace(/^#/, ""))
        : undefined;
    const dateFrom = filters.dateFrom
      ? new Date(`${filters.dateFrom}T00:00:00`)
      : undefined;
    const dateTo = filters.dateTo
      ? new Date(`${filters.dateTo}T00:00:00`)
      : undefined;
    if (dateTo) dateTo.setDate(dateTo.getDate() + 1);

    const paymentFilter: Prisma.OrderWhereInput =
      filters.paymentCategory === "REJECTED"
        ? {
            payments: {
              some: { status: { in: ["REJECTED", "CANCELLED", "EXPIRED"] } },
            },
          }
        : {
            OR: [
              {
                status: {
                  in: [
                    "PAID",
                    "IN_PRODUCTION",
                    "READY_FOR_SHIPPING",
                    "SHIPPED",
                    "DELIVERED",
                  ],
                },
              },
              {
                payments: {
                  some: {
                    status: {
                      in: ["APPROVED", "PARTIALLY_REFUNDED", "REFUNDED"],
                    },
                  },
                },
              },
            ],
          };

    const orders = await db.order.findMany({
      where: {
        ...paymentFilter,
        ...(filters.status ? { status: filters.status } : {}),
        ...(search
          ? {
              OR: [
                {
                  contactName: {
                    contains: search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  contactEmail: {
                    contains: search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  customerDocument: {
                    contains: search,
                    mode: "insensitive" as const,
                  },
                },
                ...(searchOrderNumber !== undefined
                  ? [{ orderNumber: searchOrderNumber }]
                  : []),
              ],
            }
          : {}),
        ...(dateFrom || dateTo
          ? { createdAt: { gte: dateFrom, lt: dateTo } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        contactName: true,
        customerDocument: true,
        contactEmail: true,
        totalInCents: true,
        createdAt: true,
        items: {
          take: 3,
          select: { imageUrl: true },
        },
        _count: { select: { items: true } },
        payments: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { status: true },
        },
      },
    });

    return orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      contactName: order.contactName,
      customerDocument: order.customerDocument,
      contactEmail: order.contactEmail,
      totalInCents: order.totalInCents,
      itemCount: order._count.items,
      imageUrls: order.items.flatMap((item) =>
        item.imageUrl ? [item.imageUrl] : [],
      ),
      createdAt: order.createdAt.toISOString(),
      paymentStatus: order.payments[0]?.status ?? null,
    }));
  },

  async updateOrderStatus(
    id: string,
    status: OrderStatusValue,
    note: string | null,
  ): Promise<OrderDetailDto> {
    const order = await db.$transaction(async (tx) => {
      if (status === "CANCELLED") {


        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;

        const current = await tx.order.findUniqueOrThrow({
          where: { id },
          select: { stockReleasedAt: true },
        });
        const shouldReleaseStock = current.stockReleasedAt === null;

        await tx.order.update({
          where: { id },
          data: {
            status,
            stockReleasedAt: shouldReleaseStock ? new Date() : undefined,
            statusHistory: { create: { status, note } },
          },
        });

        if (shouldReleaseStock) {
          const reserved = await tx.orderItem.groupBy({
            by: ["variantId"],
            where: { orderId: id, stockReserved: true },
            _sum: { quantity: true },
          });
          for (const item of reserved) {
            const quantity = item._sum.quantity ?? 0;
            if (quantity > 0) {
              await tx.productVariant.updateMany({
                where: { id: item.variantId },
                data: { stock: { increment: quantity } },
              });
            }
          }
          await tx.orderItem.updateMany({
            where: { orderId: id, stockReserved: true },
            data: { stockReserved: false },
          });
        }

        return tx.order.findUniqueOrThrow({
          where: { id },
          include: orderInclude,
        });
      }

      const updated = await tx.order.update({
        where: { id },
        data: {
          status,
          deliveredAt: status === "DELIVERED" ? new Date() : undefined,
          statusHistory: { create: { status, note } },
        },
        include: orderInclude,
      });
      return updated;
    });

    return toDto(order);
  },

  async getMetrics(period: DashboardPeriod): Promise<OrderMetricsDto> {
    const now = new Date();
    const { start, end, previousStart } = getPeriodRange(period, now);
    const periodFilter = { createdAt: { gte: start, lt: end } };
    const previousFilter = { createdAt: { gte: previousStart, lt: start } };
    const billableFilter = { status: { in: [...BILLABLE_STATUSES] } };
    const expiringBefore = new Date(now);
    expiringBefore.setDate(expiringBefore.getDate() + 30);

    const [
      allPeriodOrders,
      previousOrderCount,
      billableOrders,
      previousBillableOrders,
      statusGroups,
      pendingCommissions,
      activeAgreementCount,
      pendingDesigns,
      outOfStockProducts,
      expiringAgreements,
      newSpecialRequests,
    ] = await Promise.all([
      db.order.findMany({
        where: periodFilter,
        select: { status: true, createdAt: true, totalInCents: true },
      }),
      db.order.count({ where: previousFilter }),
      db.order.findMany({
        where: { ...periodFilter, ...billableFilter },
        select: { createdAt: true, totalInCents: true },
      }),
      db.order.findMany({
        where: { ...previousFilter, ...billableFilter },
        select: { totalInCents: true },
      }),
      db.order.groupBy({
        by: ["status"],
        where: periodFilter,
        _count: { _all: true },
      }),
      db.commissionEntry.aggregate({
        where: {
          status: {
            in: [
              "ACCRUED",
              "PENDING_RELEASE",
              "PENDING_DELIVERY",
              "RETURN_WINDOW",
              "AVAILABLE",
              "IN_SETTLEMENT",
            ],
          },
        },
        _sum: { amountInCents: true },
      }),
      db.agreement.count({
        where: {
          status: "ACTIVE",
          startDate: { lte: now },
          endDate: { gte: now },
        },
      }),
      db.design.count({ where: { status: { not: "APPROVED" } } }),
      db.product.count({
        where: {
          OR: [
            { status: "OUT_OF_STOCK" },
            { variants: { some: {}, every: { stock: { lte: 0 } } } },
          ],
        },
      }),
      db.agreement.count({
        where: { status: "ACTIVE", endDate: { gte: now, lte: expiringBefore } },
      }),
      db.specialRequest.count({ where: { status: "NEW" } }),
    ]);

    const revenueInCents = billableOrders.reduce(
      (sum, order) => sum + order.totalInCents,
      0,
    );
    const previousRevenue = previousBillableOrders.reduce(
      (sum, order) => sum + order.totalInCents,
      0,
    );
    const averageTicketInCents = billableOrders.length
      ? Math.round(revenueInCents / billableOrders.length)
      : 0;
    const previousAverage = previousBillableOrders.length
      ? Math.round(previousRevenue / previousBillableOrders.length)
      : 0;
    const statusCount = Object.fromEntries(
      statusGroups.map((group) => [group.status, group._count._all]),
    );

    return {
      period,
      periodLabel:
        period === "day"
          ? "Hoy"
          : period === "week"
            ? "Esta semana"
            : period === "year"
              ? String(now.getFullYear())
              : now.toLocaleDateString("es-AR", {
                  month: "long",
                  year: "numeric",
                }),
      totalOrders: allPeriodOrders.length,
      pendingPaymentOrders: statusCount.PENDING_PAYMENT ?? 0,
      paidOrders: statusCount.PAID ?? 0,
      inProductionOrders: statusCount.IN_PRODUCTION ?? 0,
      readyOrders: statusCount.READY_FOR_SHIPPING ?? 0,
      shippedOrders: statusCount.SHIPPED ?? 0,
      deliveredOrders: statusCount.DELIVERED ?? 0,
      cancelledOrders: statusCount.CANCELLED ?? 0,
      revenueInCents,
      averageTicketInCents,
      pendingCommissionsInCents: pendingCommissions._sum.amountInCents ?? 0,
      activeAgreementCount,
      revenueChangePercentage: percentageChange(
        revenueInCents,
        previousRevenue,
      ),
      ordersChangePercentage: percentageChange(
        allPeriodOrders.length,
        previousOrderCount,
      ),
      averageTicketChangePercentage: percentageChange(
        averageTicketInCents,
        previousAverage,
      ),
      salesSeries: buildSalesSeries(period, start, billableOrders),
      attention: {
        pendingDesigns,
        outOfStockProducts,
        expiringAgreements,
        newSpecialRequests,
      },
    };
  },
};
