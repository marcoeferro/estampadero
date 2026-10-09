import { TRPCError } from "@trpc/server";
import type { Prisma } from "generated/prisma";
import { ZodError } from "zod";

import {
  adminMutationRateLimit,
  adminProcedure,
  createTRPCRouter,
  publicProcedure,
} from "elestampadero/server/api/trpc";

import { getProductBySlug } from "../application/use-cases/get-product-by-slug";
import { listCategories } from "../application/use-cases/list-categories";
import { listProducts } from "../application/use-cases/list-products";
import { prismaCatalogRepository } from "../infrastructure/persistence/prisma-catalog-repository";
import { clubCanSellWhere } from "../infrastructure/persistence/sellable-products";
import {
  createAdminProductInputSchema,
  createCatalogLineInputSchema,
  deleteAdminProductInputSchema,
  duplicateAdminProductInputSchema,
  getProductBySlugInputSchema,
  listProductsInputSchema,
  publishApprovedDesignInputSchema,
  quickUpdateAdminProductInputSchema,
  updateAdminProductInputSchema,
} from "./schemas";

const listProductsUseCase = listProducts(prismaCatalogRepository);
const getProductBySlugUseCase = getProductBySlug(prismaCatalogRepository);
const listCategoriesUseCase = listCategories(prismaCatalogRepository);

const CLUB_CANNOT_SELL_MESSAGE =
  "El club todavía no tiene los cobros activos en Mobbex. Guardá el producto como borrador y publicalo cuando se activen.";

async function clubCanSell(
  db: Pick<Prisma.TransactionClient, "club">,
  clubId: string,
): Promise<boolean> {
  const club = await db.club.findFirst({
    where: { id: clubId, ...clubCanSellWhere },
    select: { id: true },
  });
  return club !== null;
}

/**
 * Error asociado a un campo del formulario. El formateador de tRPC lo expone
 * en `zodError.fieldErrors` para que el panel lo muestre junto al campo.
 */
function fieldError(field: string, message: string) {
  return new TRPCError({
    code: "BAD_REQUEST",
    message,
    cause: new ZodError([{ code: "custom", path: [field], message }]),
  });
}

function isUniqueConstraintError(error: unknown): error is { meta?: unknown } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

/** Traduce los choques de índices únicos a errores por campo. */
function translateUniqueError(error: unknown, code: string): never {
  if (isUniqueConstraintError(error)) {
    const target = JSON.stringify(error.meta ?? "");
    if (target.includes("sku")) {
      throw fieldError(
        "variants",
        "Un código de variante ya lo usa otro producto. Cambialo o dejalo vacío para generarlo automáticamente.",
      );
    }
    throw fieldError("code", `Ya existe un producto con el código ${code}.`);
  }
  throw error;
}

async function assertCodeAvailable(
  db: Pick<Prisma.TransactionClient, "product">,
  code: string,
  exceptProductId?: string,
) {
  const existing = await db.product.findFirst({
    where: {
      code: { equals: code, mode: "insensitive" },
      ...(exceptProductId ? { id: { not: exceptProductId } } : {}),
    },
    select: { id: true },
  });
  if (existing) {
    throw fieldError("code", `Ya existe un producto con el código ${code}.`);
  }
}

async function assertProductRelations(
  db: Pick<Prisma.TransactionClient, "agreement" | "club" | "catalogLine">,
  input: { clubId: string | null; status: string; lineId?: string | null },
) {
  if (input.clubId) {
    const activeAgreement = await db.agreement.findFirst({
      where: {
        clubId: input.clubId,
        status: "ACTIVE",
        club: { isActive: true },
      },
      select: { id: true },
    });
    if (!activeAgreement) {
      throw fieldError(
        "clubId",
        "La organización seleccionada no tiene un convenio activo.",
      );
    }
    if (
      input.status === "PUBLISHED" &&
      !(await clubCanSell(db, input.clubId))
    ) {
      throw fieldError("status", CLUB_CANNOT_SELL_MESSAGE);
    }
  }
  if (input.lineId) {
    const customLine = await db.catalogLine.findFirst({
      where: { id: input.lineId, isActive: true },
      select: { id: true },
    });
    if (!customLine) {
      throw fieldError("lineId", "La línea seleccionada no está disponible.");
    }
  }
}

async function uniqueCopyCode(
  db: Pick<Prisma.TransactionClient, "product">,
  code: string,
) {
  const base = `${code}-COPIA`.slice(0, 74);
  let candidate = base;
  let suffix = 2;
  while (
    await db.product.findFirst({
      where: { code: { equals: candidate, mode: "insensitive" } },
      select: { id: true },
    })
  ) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

const adminProductInclude = {
  images: { orderBy: { position: "asc" as const } },
  variants: { orderBy: [{ color: "asc" as const }, { size: "asc" as const }] },
  club: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  lineDefinition: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.ProductInclude;

type AdminProductRecord = Prisma.ProductGetPayload<{
  include: typeof adminProductInclude;
}>;

function toAdminProduct(product: AdminProductRecord) {
  return {
    id: product.id,
    slug: product.slug,
    code: product.code,
    name: product.name,
    description: product.description,
    priceInCents: product.priceInCents,
    compareAtCents: product.compareAtCents,
    line: product.line,
    lineId: product.lineId,
    lineDefinition: product.lineDefinition,
    status: product.status,
    allowsCustomPrint: product.allowsCustomPrint,
    isFeatured: product.isFeatured,
    showStock: product.showStock,
    club: product.club,
    category: product.category,
    images: product.images.map((image) => ({
      id: image.id,
      url: image.url,
      alt: image.alt,
      color: image.color,
    })),
    variants: product.variants.map((variant) => ({
      id: variant.id,
      size: variant.size,
      color: variant.color,
      stock: variant.stock,
      sku: variant.sku,
    })),
    totalStock: product.variants.reduce(
      (total, variant) => total + (variant.stock ?? 0),
      0,
    ),
  };
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

function generatedSku(
  code: string,
  color: string,
  size: string,
  index: number,
) {
  const value = slugify(`${code}-${color}-${size}`).toUpperCase();
  return value || `PRODUCTO-${index + 1}`;
}

export const catalogRouter = createTRPCRouter({
  list: publicProcedure
    .input(listProductsInputSchema)
    .query(({ input }) => listProductsUseCase(input)),

  bySlug: publicProcedure
    .input(getProductBySlugInputSchema)
    .query(({ input }) => getProductBySlugUseCase(input.slug)),

  categories: publicProcedure.query(() => listCategoriesUseCase()),

  adminList: adminProcedure.query(async ({ ctx }) => {
    const products = await ctx.db.product.findMany({
      include: adminProductInclude,
      orderBy: { createdAt: "desc" },
    });
    return products.map(toAdminProduct);
  }),

  lines: adminProcedure.query(async ({ ctx }) => {
    const lines = await ctx.db.catalogLine.findMany({
      include: { _count: { select: { products: true } } },
      orderBy: { name: "asc" },
    });
    return lines.map((line) => ({
      id: line.id,
      name: line.name,
      slug: line.slug,
      description: line.description,
      isActive: line.isActive,
      productCount: line._count.products,
    }));
  }),

  createLine: adminProcedure
    .input(createCatalogLineInputSchema)
    .use(adminMutationRateLimit("catalog.createLine", { limit: 20 }))
    .mutation(async ({ ctx, input }) => {
      const baseSlug = slugify(input.name);
      let slug = baseSlug || "linea";
      let suffix = 2;
      while (await ctx.db.catalogLine.findUnique({ where: { slug } })) {
        slug = `${baseSlug}-${suffix}`;
        suffix += 1;
      }
      return ctx.db.catalogLine.create({
        data: {
          name: input.name,
          slug,
          description: input.description ?? null,
        },
      });
    }),

  approvedConventionProducts: adminProcedure.query(async ({ ctx }) => {
    const designs = await ctx.db.design.findMany({
      where: { clubId: { not: null }, status: "APPROVED" },
      include: {
        club: { select: { id: true, name: true } },
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
        },
        productLinks: {
          select: {
            product: {
              select: { id: true, name: true, status: true },
            },
          },
        },
      },
      orderBy: [{ club: { name: "asc" } }, { title: "asc" }],
    });
    return designs.flatMap((design) => {
      const version = design.versions[0];
      if (!design.club || !version) return [];
      return [
        {
          designId: design.id,
          designName: design.title,
          club: design.club,
          versionId: version.id,
          versionNumber: version.versionNumber,
          imageUrl: version.imageUrl,
          approvedAt: version.updatedAt.toISOString(),
          publishedProduct: design.productLinks[0]?.product ?? null,
        },
      ];
    });
  }),

  publishApprovedDesign: adminProcedure
    .input(publishApprovedDesignInputSchema)
    .use(adminMutationRateLimit("catalog.publishApprovedDesign", { limit: 20 }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const design = await tx.design.findUnique({
          where: { id: input.designId },
          include: {
            versions: {
              orderBy: { versionNumber: "desc" },
              take: 1,
            },
            productLinks: { select: { productId: true } },
          },
        });
        if (!design?.clubId || design.status !== "APPROVED") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "El diseño debe estar aprobado y asociado a un club.",
          });
        }
        if (design.productLinks.length > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Este diseño ya fue publicado como producto.",
          });
        }
        const version = design.versions[0];
        if (version?.status !== "APPROVED") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "La última versión todavía no fue aprobada.",
          });
        }

        const canSell = await clubCanSell(tx, design.clubId);
        const uniqueSuffix = Date.now().toString(36).toUpperCase();
        const code = `CONV-${slugify(design.title).slice(0, 24).toUpperCase()}-${uniqueSuffix}`;
        const product = await tx.product.create({
          data: {
            name: input.name,
            slug: `${slugify(input.name)}-${slugify(code)}`,
            code,
            priceInCents: input.priceInCents,
            line: "CLUB",
            status: canSell ? "PUBLISHED" : "DRAFT",
            clubId: design.clubId,
            showStock: input.stock !== null,
            images: {
              create: {
                url: version.imageUrl,
                alt: input.name,
                position: 0,
              },
            },
            variants: {
              create: {
                size: "Único",
                color: "Predeterminado",
                stock: input.stock,
                sku: generatedSku(code, "Predeterminado", "Único", 0),
              },
            },
            designLinks: { create: { designId: design.id } },
          },
          include: adminProductInclude,
        });
        return toAdminProduct(product);
      }),
    ),

  adminCreate: adminProcedure
    .input(createAdminProductInputSchema)
    .use(adminMutationRateLimit("catalog.createProduct", { limit: 20 }))
    .mutation(async ({ ctx, input }) => {
      await assertProductRelations(ctx.db, input);
      await assertCodeAvailable(ctx.db, input.code);
      const product = await ctx.db.product
        .create({
          data: {
            name: input.name,
            slug: `${slugify(input.name)}-${slugify(input.code)}`,
            code: input.code,
            description: input.description ?? null,
            priceInCents: input.priceInCents,
            compareAtCents: input.compareAtCents,
            line: input.line,
            lineId: input.lineId ?? null,
            status: input.status,
            clubId: input.clubId,
            allowsCustomPrint: input.allowsCustomPrint,
            isFeatured: input.isFeatured,
            showStock: input.showStock,
            images: {
              create: input.images.map((image, position) => ({
                url: image.url,
                alt: image.alt ?? null,
                color: image.color ?? null,
                position,
              })),
            },
            variants: {
              create: input.variants.map((variant, index) => ({
                size: variant.size,
                color: variant.color,
                stock: variant.stock,
                sku:
                  variant.sku ??
                  generatedSku(input.code, variant.color, variant.size, index),
              })),
            },
          },
          include: adminProductInclude,
        })
        .catch((error: unknown) => translateUniqueError(error, input.code));
      return toAdminProduct(product);
    }),

  adminUpdate: adminProcedure
    .input(updateAdminProductInputSchema)
    .use(adminMutationRateLimit("catalog.updateProduct", { limit: 40 }))
    .mutation(async ({ ctx, input }) =>
      ctx.db
        .$transaction(async (tx) => {
          await assertProductRelations(tx, input);
          await assertCodeAvailable(tx, input.code, input.id);
          const current = await tx.product.findUnique({
            where: { id: input.id },
            select: {
              variants: { select: { id: true } },
              images: { select: { id: true } },
            },
          });
          if (!current) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "El producto ya no existe.",
            });
          }

          await tx.product.update({
            where: { id: input.id },
            data: {
              name: input.name,
              code: input.code,
              description: input.description ?? null,
              priceInCents: input.priceInCents,
              compareAtCents: input.compareAtCents,
              line: input.line,
              lineId: input.lineId ?? null,
              status: input.status,
              clubId: input.clubId,
              allowsCustomPrint: input.allowsCustomPrint,
              isFeatured: input.isFeatured,
              showStock: input.showStock,
            },
          });

          const variantIds = new Set(current.variants.map(({ id }) => id));
          const keptVariantIds = input.variants.flatMap((variant) =>
            variant.id && variantIds.has(variant.id) ? [variant.id] : [],
          );
          await tx.productVariant.deleteMany({
            where: {
              productId: input.id,
              ...(keptVariantIds.length > 0
                ? { id: { notIn: keptVariantIds } }
                : {}),
            },
          });
          for (const [index, variant] of input.variants.entries()) {
            const data = {
              size: variant.size,
              color: variant.color,
              stock: variant.stock,
              sku:
                variant.sku ??
                generatedSku(input.code, variant.color, variant.size, index),
            };
            if (variant.id && variantIds.has(variant.id)) {
              await tx.productVariant.update({
                where: { id: variant.id },
                data,
              });
            } else {
              await tx.productVariant.create({
                data: { ...data, productId: input.id },
              });
            }
          }

          const imageIds = new Set(current.images.map(({ id }) => id));
          const keptImageIds = input.images.flatMap((image) =>
            image.id && imageIds.has(image.id) ? [image.id] : [],
          );
          await tx.productImage.deleteMany({
            where: {
              productId: input.id,
              ...(keptImageIds.length > 0
                ? { id: { notIn: keptImageIds } }
                : {}),
            },
          });
          for (const [position, image] of input.images.entries()) {
            const data = {
              url: image.url,
              alt: image.alt ?? null,
              color: image.color ?? null,
              position,
            };
            if (image.id && imageIds.has(image.id)) {
              await tx.productImage.update({
                where: { id: image.id },
                data,
              });
            } else {
              await tx.productImage.create({
                data: { ...data, productId: input.id },
              });
            }
          }

          const updated = await tx.product.findUniqueOrThrow({
            where: { id: input.id },
            include: adminProductInclude,
          });
          return toAdminProduct(updated);
        })
        .catch((error: unknown) => translateUniqueError(error, input.code)),
    ),

  adminDuplicate: adminProcedure
    .input(duplicateAdminProductInputSchema)
    .use(adminMutationRateLimit("catalog.duplicateProduct", { limit: 20 }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const source = await tx.product.findUnique({
          where: { id: input.id },
          include: {
            images: { orderBy: { position: "asc" } },
            variants: true,
          },
        });
        if (!source) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "El producto ya no existe.",
          });
        }
        const code = await uniqueCopyCode(tx, source.code);
        const name = `${source.name} (copia)`.slice(0, 160);
        // La copia queda como borrador para revisarla antes de publicarla.
        const product = await tx.product.create({
          data: {
            name,
            slug: `${slugify(name)}-${slugify(code)}`,
            code,
            description: source.description,
            priceInCents: source.priceInCents,
            compareAtCents: source.compareAtCents,
            line: source.line,
            lineId: source.lineId,
            status: "DRAFT",
            clubId: source.clubId,
            categoryId: source.categoryId,
            allowsCustomPrint: source.allowsCustomPrint,
            isFeatured: false,
            showStock: source.showStock,
            images: {
              create: source.images.map((image, position) => ({
                url: image.url,
                alt: image.alt,
                color: image.color,
                position,
              })),
            },
            variants: {
              create: source.variants.map((variant, index) => ({
                size: variant.size,
                color: variant.color,
                stock: variant.stock,
                sku: generatedSku(code, variant.color, variant.size, index),
              })),
            },
          },
          include: adminProductInclude,
        });
        return toAdminProduct(product);
      }),
    ),

  adminQuickUpdate: adminProcedure
    .input(quickUpdateAdminProductInputSchema)
    .use(adminMutationRateLimit("catalog.quickUpdateProduct", { limit: 120 }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const current = await tx.product.findUnique({
          where: { id: input.id },
          select: {
            clubId: true,
            showStock: true,
            variants: { select: { id: true } },
          },
        });
        if (!current) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "El producto ya no existe.",
          });
        }
        if (input.status === "PUBLISHED") {
          if (current.variants.length === 0) {
            throw fieldError(
              "status",
              "Para publicar el producto agregá al menos un talle.",
            );
          }
          if (current.clubId && !(await clubCanSell(tx, current.clubId))) {
            throw fieldError("status", CLUB_CANNOT_SELL_MESSAGE);
          }
        }
        if (input.variantStocks?.length) {
          if (!current.showStock) {
            throw fieldError(
              "variantStocks",
              "El producto se vende por encargo y no lleva stock.",
            );
          }
          const variantIds = new Set(current.variants.map(({ id }) => id));
          for (const { id, stock } of input.variantStocks) {
            if (!variantIds.has(id)) {
              throw fieldError(
                "variantStocks",
                "Una de las variantes ya no existe. Recargá la página.",
              );
            }
            await tx.productVariant.update({ where: { id }, data: { stock } });
          }
        }
        const updated = await tx.product.update({
          where: { id: input.id },
          data: {
            ...(input.priceInCents !== undefined
              ? { priceInCents: input.priceInCents }
              : {}),
            ...(input.status ? { status: input.status } : {}),
          },
          include: adminProductInclude,
        });
        return toAdminProduct(updated);
      }),
    ),

  adminDelete: adminProcedure
    .input(deleteAdminProductInputSchema)
    .use(adminMutationRateLimit("catalog.deleteProduct", { limit: 10 }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.product.delete({ where: { id: input.id } });
      return { id: input.id };
    }),
});
