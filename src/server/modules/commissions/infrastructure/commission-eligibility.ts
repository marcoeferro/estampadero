import "server-only";

import { db } from "elestampadero/server/db";

import { refundAdjustmentSchedule } from "../application/refund-adjustment-schedule";

const DAY_MS = 24 * 60 * 60_000;
const MUTABLE_STATUSES = [
  "ACCRUED",
  "PENDING_RELEASE",
  "PENDING_DELIVERY",
  "RETURN_WINDOW",
  "AVAILABLE",
] as const;

async function getReturnWindowDays(): Promise<number> {
  const settings = await db.siteContentSetting.findUnique({
    where: { id: "home" },
    select: { returnWindowDays: true },
  });
  return settings?.returnWindowDays ?? 10;
}

async function syncEntries(
  where: { paymentId?: string; orderId?: string },
  now = new Date(),
): Promise<void> {
  const entries = await db.commissionEntry.findMany({
    where: { ...where, status: { in: [...MUTABLE_STATUSES] } },
    select: {
      id: true,
      payment: { select: { moneyReleasedAt: true } },
      order: { select: { deliveredAt: true } },
    },
  });
  if (entries.length === 0) return;

  const returnWindowDays = await getReturnWindowDays();
  for (const entry of entries) {
    const releasedAt = entry.payment?.moneyReleasedAt ?? null;
    const deliveredAt = entry.order.deliveredAt;
    const returnWindowEndsAt = deliveredAt
      ? new Date(deliveredAt.getTime() + returnWindowDays * DAY_MS)
      : null;
    const status = !releasedAt
      ? "PENDING_RELEASE"
      : !deliveredAt
        ? "PENDING_DELIVERY"
        : returnWindowEndsAt && returnWindowEndsAt > now
          ? "RETURN_WINDOW"
          : "AVAILABLE";

    await db.commissionEntry.update({
      where: { id: entry.id },
      data: {
        status,
        releasedAt,
        returnWindowEndsAt,
        availableAt:
          status === "AVAILABLE" ? (returnWindowEndsAt ?? now) : null,
      },
    });
  }
}

export function syncCommissionEligibilityForPayment(
  paymentId: string,
  now = new Date(),
): Promise<void> {
  return (async () => {
    await syncEntries({ paymentId }, now);
    await syncProviderRefundAdjustments(paymentId, now);
  })();
}

export function syncCommissionEligibilityForOrder(
  orderId: string,
  now = new Date(),
): Promise<void> {
  return syncEntries({ orderId }, now);
}

export async function matureCommissionEntries(now = new Date()): Promise<void> {
  const entries = await db.commissionEntry.findMany({
    where: {
      status: "RETURN_WINDOW",
      returnWindowEndsAt: { lte: now },
      settlementId: null,
    },
    select: { orderId: true },
    distinct: ["orderId"],
  });
  for (const entry of entries) {
    await syncCommissionEligibilityForOrder(entry.orderId, now);
  }
}

async function syncProviderRefundAdjustments(
  paymentId: string,
  now: Date,
): Promise<void> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: {
      amountInCents: true,
      amountRefundedInCents: true,
      provider: true,
    },
  });
  if (!payment || payment.amountRefundedInCents <= 0) return;

  const [sales, existing] = await Promise.all([
    db.commissionEntry.findMany({
      where: { paymentId, entryType: "SALE" },
      orderBy: { id: "asc" },
    }),
    db.commissionEntry.aggregate({
      where: { paymentId, entryType: "REFUND_ADJUSTMENT" },
      _sum: { baseAmountInCents: true },
    }),
  ]);
  if (sales.length === 0) return;

  const totalCommissionBase = sales.reduce(
    (sum, sale) => sum + sale.baseAmountInCents,
    0,
  );
  const targetAllocated = Math.round(
    (payment.amountRefundedInCents * totalCommissionBase) /
      payment.amountInCents,
  );
  const alreadyAllocated = Math.abs(existing._sum.baseAmountInCents ?? 0);
  const delta = targetAllocated - alreadyAllocated;
  if (delta <= 0) return;

  let allocated = 0;
  await db.$transaction(async (tx) => {
    for (const [index, sale] of sales.entries()) {
      const baseAdjustment =
        index === sales.length - 1
          ? delta - allocated
          : Math.round((delta * sale.baseAmountInCents) / totalCommissionBase);
      allocated += baseAdjustment;
      if (baseAdjustment <= 0) continue;
      const schedule = refundAdjustmentSchedule({
        provider: payment.provider,
        sale,
        now,
      });
      await tx.commissionEntry.upsert({
        where: {
          sourceKey: `provider-refund:${paymentId}:${payment.amountRefundedInCents}:${sale.id}`,
        },
        update: {},
        create: {
          clubId: sale.clubId,
          agreementId: sale.agreementId,
          orderId: sale.orderId,
          orderItemId: sale.orderItemId,
          paymentId,
          orderNumber: sale.orderNumber,
          productName: `Ajuste devolución · ${sale.productName}`,
          entryType: "REFUND_ADJUSTMENT",
          sourceKey: `provider-refund:${paymentId}:${payment.amountRefundedInCents}:${sale.id}`,
          baseAmountInCents: -baseAdjustment,
          percentageApplied: sale.percentageApplied,
          amountInCents: -Math.round(
            (baseAdjustment * sale.percentageApplied) / 100,
          ),
          status: schedule.status,
          releasedAt: schedule.releasedAt,
          returnWindowEndsAt: sale.returnWindowEndsAt,
          availableAt: schedule.availableAt,
        },
      });
    }
  });
}
