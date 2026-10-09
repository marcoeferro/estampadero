import { resolveRateForProductUseCase } from "elestampadero/server/modules/agreements";
import { db } from "elestampadero/server/db";

import { generateCommissionEntriesForOrder } from "./application/use-cases/generate-commission-entries-for-order";
import { prismaCommissionsRepository } from "./infrastructure/persistence/prisma-commissions-repository";

export { commissionsRouter } from "./presentation/router";
export type {
  ClubBalanceDto,
  CommissionEntryDto,
} from "./application/dto/commission";
export { refundAdjustmentSchedule } from "./application/refund-adjustment-schedule";
export {
  matureCommissionEntries,
  syncCommissionEligibilityForOrder,
  syncCommissionEligibilityForPayment,
} from "./infrastructure/commission-eligibility";

export const generateCommissionEntriesForOrderUseCase =
  generateCommissionEntriesForOrder({
    repository: prismaCommissionsRepository,
    resolveRateForProduct: resolveRateForProductUseCase,
    getReturnWindowDays: async () =>
      (
        await db.siteContentSetting.findUnique({
          where: { id: "home" },
          select: { returnWindowDays: true },
        })
      )?.returnWindowDays ?? 10,
  });
