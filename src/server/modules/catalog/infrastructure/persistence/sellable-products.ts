import type { Prisma } from "generated/prisma";

// Un club solo puede vender cuando tiene los cobros Mobbex activos: sin
// entidad receptora no se puede armar el split y el checkout fallaría.
export const clubCanSellWhere = {
  isActive: true,
  mobbexOnboardingStatus: "ACTIVE",
  mobbexEntityId: { not: null },
} satisfies Prisma.ClubWhereInput;

export const sellableProductWhere = {
  status: "PUBLISHED",
  OR: [{ clubId: null }, { club: clubCanSellWhere }],
} satisfies Prisma.ProductWhereInput;
