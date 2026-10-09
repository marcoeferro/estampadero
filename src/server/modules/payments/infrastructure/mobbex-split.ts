import "server-only";

import { TRPCError } from "@trpc/server";

import { env } from "elestampadero/env";
import { resolveRateForProductUseCase } from "elestampadero/server/modules/agreements";
import type { OrderDetailDto } from "elestampadero/server/modules/orders";
import { db } from "elestampadero/server/db";

import type { CreateCheckoutSessionInput } from "../application/ports/payment-gateway";
import {
  computeMobbexSplit,
  SplitConfigurationError,
} from "./mobbex-split-calculation";

export async function buildMobbexSplit(
  order: OrderDetailDto,
): Promise<CreateCheckoutSessionInput["split"]> {
  const clubIds = [
    ...new Set(
      order.items.flatMap((item) => (item.clubId ? [item.clubId] : [])),
    ),
  ];
  if (clubIds.length === 0) return undefined;

  const clubs = await db.club.findMany({
    where: { id: { in: clubIds } },
    select: {
      id: true,
      name: true,
      mobbexEntityId: true,
      mobbexOnboardingStatus: true,
    },
  });

  return computeMobbexSplit(order, {
    clubs: clubs.map((club) => ({
      id: club.id,
      name: club.name,
      entityId:
        club.mobbexOnboardingStatus === "ACTIVE" ? club.mobbexEntityId : null,
    })),
    resolveRate: resolveRateForProductUseCase,
    originatorEntityId: env.MOBBEX_ENTITY_ID ?? null,
  }).catch((error: unknown) => {
    if (error instanceof SplitConfigurationError) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: error.message,
      });
    }
    throw error;
  });
}
