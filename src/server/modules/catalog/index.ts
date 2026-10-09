import { getVariantsForPricing } from "./application/use-cases/get-variants-for-pricing";
import { prismaCatalogRepository } from "./infrastructure/persistence/prisma-catalog-repository";

export { catalogRouter } from "./presentation/router";
export type { ProductSummaryDto } from "./application/dto/product-summary";
export type {
  ProductDetailDto,
  ProductVariantDto,
} from "./application/dto/product-detail";
export type { VariantForPricingDto } from "./application/dto/variant-pricing";
export {
  clubCanSellWhere,
  sellableProductWhere,
} from "./infrastructure/persistence/sellable-products";

export const getVariantsForPricingUseCase = getVariantsForPricing(
  prismaCatalogRepository,
);
