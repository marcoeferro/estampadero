import "server-only";

import { db } from "elestampadero/server/db";

import type { InvoicingRepository } from "../../application/ports/invoicing-repository";

const PAID_STATUSES = new Set([
  "PAID",
  "IN_PRODUCTION",
  "READY_FOR_SHIPPING",
  "SHIPPED",
  "DELIVERED",
]);

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export const prismaInvoicingRepository: InvoicingRepository = {
  async getOrder(orderId) {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        payments: {
          select: {
            status: true,
            amountRefundedInCents: true,
            approvedAt: true,
          },
        },
      },
    });
    if (!order) return null;
    const isPaid =
      PAID_STATUSES.has(order.status) ||
      order.payments.some((payment) => payment.approvedAt !== null);
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      isPaid,
      contactName: order.contactName,
      customerDocument: order.customerDocument,
      customerTaxId: order.customerTaxId,
      customerLegalName: order.customerLegalName,
      customerTaxCondition: order.customerTaxCondition,
      shippingInCents: order.shippingInCents,
      totalInCents: order.totalInCents,
      refundedInCents: order.payments.reduce(
        (total, payment) => total + payment.amountRefundedInCents,
        0,
      ),
      items: order.items.map((item) => ({
        productName: item.productName,
        size: item.size,
        color: item.color,
        quantity: item.quantity,
        lineTotalInCents: item.lineTotalInCents,
        clubId: item.clubId,
        clubSharePercentage: item.clubSharePercentage,
      })),
    };
  },

  listVouchersForOrder: (orderId) =>
    db.fiscalVoucher.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" },
    }),

  findVoucher: (id) => db.fiscalVoucher.findUnique({ where: { id } }),

  findByProviderVoucherId: (providerVoucherId) =>
    db.fiscalVoucher.findFirst({ where: { providerVoucherId } }),

  async createVoucherOnce(voucher) {
    try {
      return await db.fiscalVoucher.create({ data: voucher });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      return db.fiscalVoucher.findUniqueOrThrow({
        where: { idempotencyKey: voucher.idempotencyKey },
      });
    }
  },

  async claimVoucher(id, now) {
    const claimed = await db.fiscalVoucher.updateMany({
      where: { id, status: "PENDING", nextAttemptAt: { lte: now } },
      data: { status: "PROCESSING" },
    });
    if (claimed.count === 0) return null;
    return db.fiscalVoucher.findUnique({ where: { id } });
  },

  updateVoucher: (id, data) => db.fiscalVoucher.update({ where: { id }, data }),

  async listDuePendingIds(now, limit) {
    const rows = await db.fiscalVoucher.findMany({
      where: { status: "PENDING", nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: "asc" },
      take: limit,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  },

  listAwaitingAuthorization: (limit) =>
    db.fiscalVoucher.findMany({
      where: { status: "AWAITING_AUTHORIZATION" },
      orderBy: { updatedAt: "asc" },
      take: limit,
    }),

  async releaseStuck(olderThan) {
    const result = await db.fiscalVoucher.updateMany({
      where: { status: "PROCESSING", updatedAt: { lt: olderThan } },
      data: { status: "PENDING" },
    });
    return result.count;
  },

  async listOrdersWithRefunds(limit) {
    const rows = await db.order.findMany({
      where: {
        payments: { some: { amountRefundedInCents: { gt: 0 } } },
        fiscalVouchers: { some: { kind: "INVOICE", status: "ISSUED" } },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  },
};
