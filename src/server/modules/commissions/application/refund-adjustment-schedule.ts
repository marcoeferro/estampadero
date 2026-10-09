import type { CommissionStatus } from "generated/prisma";

export interface RefundAdjustmentSchedule {
  status: CommissionStatus;
  releasedAt: Date | null;
  availableAt: Date | null;
}

const FROZEN_STATUSES: ReadonlySet<CommissionStatus> = new Set([
  "IN_SETTLEMENT",
  "SETTLED",
]);

/**
 * Decide cómo queda el ajuste negativo de una comisión cuando se devuelve
 * dinero. En Mobbex el split ya repartió la venta y la devolución se revierte
 * sobre las operaciones del split, así que el ajuste nace liquidado y nunca
 * entra en una liquidación manual. En los medios anteriores, si la venta ya
 * se liquidó, el ajuste se descuenta en la próxima liquidación.
 */
export function refundAdjustmentSchedule(input: {
  provider: string;
  sale: {
    status: CommissionStatus;
    releasedAt: Date | null;
    availableAt: Date | null;
  };
  now: Date;
}): RefundAdjustmentSchedule {
  if (input.provider === "MOBBEX") {
    return { status: "SETTLED", releasedAt: input.now, availableAt: null };
  }
  if (FROZEN_STATUSES.has(input.sale.status)) {
    return {
      status: "AVAILABLE",
      releasedAt: input.sale.releasedAt,
      availableAt: input.now,
    };
  }
  return {
    status: input.sale.status,
    releasedAt: input.sale.releasedAt,
    availableAt: input.sale.availableAt,
  };
}
