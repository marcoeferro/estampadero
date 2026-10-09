import type { OrderDetailDto } from "elestampadero/server/modules/orders";

import type { CreateCheckoutSessionInput } from "../application/ports/payment-gateway";

type SplitItem = NonNullable<CreateCheckoutSessionInput["split"]>[number];

const MAX_SPLIT_ENTRIES = 50;

export class SplitConfigurationError extends Error {}

export interface SplitClub {
  id: string;
  name: string;
  /** UID Mobbex del club; null si los cobros todavía no están activos. */
  entityId: string | null;
}

export interface ComputeMobbexSplitDeps {
  clubs: SplitClub[];
  /** Solo para pedidos anteriores al guardado del porcentaje en el ítem. */
  resolveRate: (
    clubId: string,
    productId: string,
  ) => Promise<{ percentage: number } | null>;
  originatorEntityId: string | null;
}

/**
 * Agrupa las líneas por club. Cada club cobra el bruto de sus productos y
 * Mobbex le descuenta como `fee` la parte del taller. Los productos propios y
 * el envío se asignan a la entidad originante.
 */
export async function computeMobbexSplit(
  order: Pick<OrderDetailDto, "orderNumber" | "totalInCents" | "items">,
  deps: ComputeMobbexSplitDeps,
): Promise<CreateCheckoutSessionInput["split"]> {
  const clubLines = order.items.filter(
    (item): item is typeof item & { clubId: string } => item.clubId !== null,
  );
  if (clubLines.length === 0) return undefined;

  const clubById = new Map(deps.clubs.map((club) => [club.id, club]));
  const grouped = new Map<string, { gross: number; clubAmount: number }>();

  for (const line of clubLines) {
    const club = clubById.get(line.clubId);
    if (!club?.entityId) {
      throw new SplitConfigurationError(
        `${club?.name ?? line.clubNameSnapshot ?? "Uno de los clubes"} todavía no tiene los cobros activos.`,
      );
    }
    const percentage =
      line.clubSharePercentage ??
      (await deps.resolveRate(line.clubId, line.productId))?.percentage;
    if (percentage === undefined) {
      throw new SplitConfigurationError(
        `${club.name} no tiene un convenio activo para este producto.`,
      );
    }
    const current = grouped.get(line.clubId) ?? { gross: 0, clubAmount: 0 };
    current.gross += line.lineTotalInCents;
    current.clubAmount += Math.round(
      (line.lineTotalInCents * percentage) / 100,
    );
    grouped.set(line.clubId, current);
  }

  const split: SplitItem[] = [...grouped.entries()].map(([clubId, amount]) => {
    const club = clubById.get(clubId)!;
    return {
      entity: club.entityId!,
      totalInCents: amount.gross,
      feeInCents: amount.gross - amount.clubAmount,
      reference: `order-${order.orderNumber}-club-${clubId}`,
      description: `Participación ${club.name} · Pedido #${order.orderNumber}`,
    };
  });

  const assignedToClubs = split.reduce(
    (total, item) => total + item.totalInCents,
    0,
  );
  const originatorAmount = order.totalInCents - assignedToClubs;
  if (originatorAmount < 0) {
    throw new Error("El split calculado supera el total del pedido.");
  }
  if (originatorAmount > 0) {
    if (!deps.originatorEntityId) {
      throw new SplitConfigurationError("Los pagos aún no están configurados.");
    }
    split.push({
      entity: deps.originatorEntityId,
      totalInCents: originatorAmount,
      feeInCents: 0,
      reference: `order-${order.orderNumber}-store`,
      description: `Productos propios y envío · Pedido #${order.orderNumber}`,
    });
  }

  if (split.length > MAX_SPLIT_ENTRIES) {
    throw new SplitConfigurationError(
      "El pedido supera el máximo de 50 entidades permitido por Mobbex.",
    );
  }
  return split;
}
