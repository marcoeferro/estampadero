import "server-only";

import type { OrderDetailDto } from "elestampadero/server/modules/orders";

import type { CommissionsRepository } from "../ports/commissions-repository";

interface GenerateCommissionEntriesDeps {
  repository: CommissionsRepository;
  resolveRateForProduct: (
    clubId: string,
    productId: string,
  ) => Promise<{ agreementId: string; percentage: number } | null>;
  getReturnWindowDays?: () => Promise<number>;
}

export function generateCommissionEntriesForOrder(
  deps: GenerateCommissionEntriesDeps,
) {
  return async (order: OrderDetailDto): Promise<void> => {
    const returnWindowDays = (await deps.getReturnWindowDays?.()) ?? 10;
    const now = new Date();
    const wasDistributedByMobbex = order.payment?.provider === "MOBBEX";
    const releasedAt = order.payment?.moneyReleasedAt
      ? new Date(order.payment.moneyReleasedAt)
      : wasDistributedByMobbex
        ? now
        : null;
    const deliveredAt = order.deliveredAt ? new Date(order.deliveredAt) : null;
    const returnWindowEndsAt = deliveredAt
      ? new Date(deliveredAt.getTime() + returnWindowDays * 24 * 60 * 60_000)
      : null;
    const status = wasDistributedByMobbex
      ? "SETTLED"
      : !releasedAt
        ? "PENDING_RELEASE"
        : !deliveredAt
          ? "PENDING_DELIVERY"
          : returnWindowEndsAt && returnWindowEndsAt > now
            ? "RETURN_WINDOW"
            : "AVAILABLE";
    const clubItems = order.items.filter(
      (item): item is typeof item & { clubId: string } => item.clubId !== null,
    );

    for (const item of clubItems) {
      // El porcentaje guardado en el pedido es el mismo que usó el split.
      const rate =
        item.clubAgreementId && item.clubSharePercentage !== null
          ? {
              agreementId: item.clubAgreementId,
              percentage: item.clubSharePercentage,
            }
          : await deps.resolveRateForProduct(item.clubId, item.productId);
      if (!rate) continue;

      const amountInCents = Math.round(
        (item.lineTotalInCents * rate.percentage) / 100,
      );

      await deps.repository.createEntryIfNotExists({
        clubId: item.clubId,
        agreementId: rate.agreementId,
        orderId: order.id,
        orderItemId: item.id,
        orderNumber: order.orderNumber,
        productName: item.productName,
        baseAmountInCents: item.lineTotalInCents,
        percentageApplied: rate.percentage,
        amountInCents,
        paymentId: order.payment?.id ?? null,
        status,
        releasedAt,
        returnWindowEndsAt,
        availableAt: status === "AVAILABLE" ? now : returnWindowEndsAt,
      });
    }
  };
}
