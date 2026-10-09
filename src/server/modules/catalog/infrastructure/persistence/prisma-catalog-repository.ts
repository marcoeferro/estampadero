import "server-only";

import type { Prisma } from "generated/prisma";

import { db } from "elestampadero/server/db";

import type {
  CatalogRepository,
  ListProductsFilters,
} from "../../application/ports/catalog-repository";
import type { ProductDetailDto } from "../../application/dto/product-detail";
import type { ProductSummaryDto } from "../../application/dto/product-summary";
import { sellableProductWhere } from "./sellable-products";
import type { VariantForPricingDto } from "../../application/dto/variant-pricing";

const summaryInclude = {
  images: { orderBy: { position: "asc" as const } },
  variants: true,
  club: { select: { slug: true, name: true, logoUrl: true } },
  category: { select: { slug: true, name: true } },
} satisfies Prisma.ProductInclude;

type ProductWithSummaryRelations = Prisma.ProductGetPayload<{
  include: typeof summaryInclude;
}>;

function toSummaryDto(product: ProductWithSummaryRelations): ProductSummaryDto {
  const imageColors = new Set(
    product.images.flatMap((image) => (image.color ? [image.color] : [])),
  );
  const defaultVariant =
    product.variants.find(
      (variant) =>
        (product.showStock ? (variant.stock ?? 0) > 0 : variant.stock !== 0) &&
        imageColors.has(variant.color),
    ) ??
    product.variants.find((variant) =>
      product.showStock ? (variant.stock ?? 0) > 0 : variant.stock !== 0,
    );

  return {
    id: product.id,
    slug: product.slug,
    code: product.code,
    name: product.name,
    priceInCents: product.priceInCents,
    compareAtCents: product.compareAtCents,
    line: product.line,
    allowsCustomPrint: product.allowsCustomPrint,
    isFeatured: product.isFeatured,
    showStock: product.showStock,
    imageUrl: product.images[0]?.url ?? null,
    imageUrls: product.images.map((image) => image.url),
    images: product.images.map((image) => ({
      url: image.url,
      color: image.color,
    })),
    totalStock: product.variants.reduce(
      (sum, variant) => sum + (variant.stock ?? 0),
      0,
    ),
    colors: [
      ...new Set(
        product.variants
          .filter(
            (variant) =>
              (product.showStock
                ? (variant.stock ?? 0) > 0
                : variant.stock !== 0) && imageColors.has(variant.color),
          )
          .map((variant) => variant.color),
      ),
    ],
    variants: product.variants.map((variant) => ({
      id: variant.id,
      size: variant.size,
      color: variant.color,
      stock: variant.stock,
    })),
    defaultVariant: defaultVariant
      ? {
          id: defaultVariant.id,
          size: defaultVariant.size,
          color: defaultVariant.color,
        }
      : null,
    createdAt: product.createdAt,
    club: product.club,
    category: product.category,
  };
}

export const prismaCatalogRepository: CatalogRepository = {
  async listPublishedProducts(
    filters: ListProductsFilters,
  ): Promise<ProductSummaryDto[]> {
    const filtersWhere: Prisma.ProductWhereInput = {
      ...(filters.categorySlug
        ? { category: { slug: filters.categorySlug } }
        : {}),
      ...(filters.clubSlug ? { club: { slug: filters.clubSlug } } : {}),
      ...(filters.line
        ? {
            line: filters.line as Prisma.EnumProductLineNullableFilter["equals"],
          }
        : {}),
      ...(filters.featured ? { isFeatured: true } : {}),
      ...(filters.availableOnly === false
        ? {}
        : {
            AND: [
              {
                OR: [
                  { variants: { some: { stock: { gt: 0 } } } },
                  { showStock: false, variants: { some: { stock: null } } },
                ],
              },
            ],
          }),
      ...(filters.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: "insensitive" } },
              { code: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const where: Prisma.ProductWhereInput = {
      AND: [sellableProductWhere, filtersWhere],
    };

    const products = await db.product.findMany({
      where,
      include: summaryInclude,
      orderBy: { createdAt: "desc" },
    });

    if (filters.sort === "BEST_SELLING") {
      const sales = await db.orderItem.groupBy({
        by: ["productId"],
        where: {
          order: {
            status: { notIn: ["PENDING_PAYMENT", "CANCELLED"] },
          },
        },
        _sum: { quantity: true },
      });
      const unitsSoldByProduct = new Map(
        sales.map((sale) => [sale.productId, sale._sum.quantity ?? 0]),
      );

      products.sort((left, right) => {
        const salesDifference =
          (unitsSoldByProduct.get(right.id) ?? 0) -
          (unitsSoldByProduct.get(left.id) ?? 0);

        return (
          salesDifference ||
          right.createdAt.getTime() - left.createdAt.getTime()
        );
      });
    }

    return products.map(toSummaryDto);
  },

  async getPublishedProductBySlug(
    slug: string,
  ): Promise<ProductDetailDto | null> {
    const product = await db.product.findFirst({
      where: { AND: [sellableProductWhere, { slug }] },
      include: {
        images: { orderBy: { position: "asc" } },
        variants: true,
        club: { select: { slug: true, name: true, logoUrl: true } },
        category: { select: { slug: true, name: true } },
      },
    });

    if (!product) return null;

    return {
      id: product.id,
      slug: product.slug,
      code: product.code,
      name: product.name,
      description: product.description,
      priceInCents: product.priceInCents,
      compareAtCents: product.compareAtCents,
      line: product.line,
      allowsCustomPrint: product.allowsCustomPrint,
      showStock: product.showStock,
      images: product.images.map((image) => ({
        url: image.url,
        alt: image.alt,
        color: image.color,
      })),
      variants: product.variants.map((variant) => ({
        id: variant.id,
        size: variant.size,
        color: variant.color,
        stock: variant.stock,
      })),
      club: product.club,
      category: product.category,
    };
  },

  async listCategories() {
    return db.category.findMany({
      select: { slug: true, name: true },
      orderBy: { name: "asc" },
    });
  },

  async getVariantsForPricing(
    variantIds: string[],
  ): Promise<VariantForPricingDto[]> {
    if (variantIds.length === 0) return [];

    const variants = await db.productVariant.findMany({
      where: { id: { in: variantIds }, product: sellableProductWhere },
      include: {
        product: {
          include: {
            images: { orderBy: { position: "asc" } },
            club: { select: { id: true, name: true } },
          },
        },
      },
    });

    return variants.map((variant) => ({
      variantId: variant.id,
      size: variant.size,
      color: variant.color,
      stock: variant.stock,
      showStock: variant.product.showStock,
      productId: variant.product.id,
      productName: variant.product.name,
      productSlug: variant.product.slug,
      priceInCents: variant.product.priceInCents,
      imageUrl:
        variant.product.images.find((image) => image.color === variant.color)
          ?.url ??
        variant.product.images[0]?.url ??
        null,
      clubId: variant.product.club?.id ?? null,
      clubName: variant.product.club?.name ?? null,
    }));
  },
};
