import { z } from "zod";

import { safeTextSchema } from "elestampadero/server/security/safe-text";

export const listProductsInputSchema = z.object({
  categorySlug: z.string().min(1).max(100).optional(),
  clubSlug: z.string().min(1).max(100).optional(),
  line: z.enum(["CLUB", "URBANA", "TRAINING", "TRABAJO", "ESCOLAR"]).optional(),
  search: safeTextSchema({ max: 120 }).optional(),
  featured: z.boolean().optional(),
  sort: z.enum(["NEWEST", "BEST_SELLING"]).optional(),
  availableOnly: z.boolean().default(true),
});

export const getProductBySlugInputSchema = z.object({
  slug: z.string().min(1).max(160),
});

const productLineSchema = z.enum([
  "CLUB",
  "URBANA",
  "TRAINING",
  "TRABAJO",
  "ESCOLAR",
]);

const productStatusSchema = z.enum(["DRAFT", "PUBLISHED", "OUT_OF_STOCK"]);
const customLineIdSchema = z.string().min(1).max(60).nullable().optional();

const productImageSchema = z.object({
  id: z.string().min(1).max(60).optional(),
  url: z
    .string()
    .trim()
    .min(1, "Ingresá una ruta o URL para la imagen.")
    .max(500)
    .refine(
      (value) =>
        (value.startsWith("/") && !value.startsWith("//")) ||
        value.startsWith("https://"),
      "La imagen debe usar una ruta interna o una URL HTTPS.",
    ),
  alt: safeTextSchema({ max: 160 }).nullable().optional(),
  color: safeTextSchema({ max: 60 }).nullable().optional(),
});

const productVariantSchema = z.object({
  id: z.string().min(1).max(60).optional(),
  size: safeTextSchema({ min: 1, max: 30 }),
  color: safeTextSchema({ min: 1, max: 60 }),
  stock: z.number().int().min(0).max(1_000_000).nullable(),
  sku: safeTextSchema({ max: 100 }).nullable().optional(),
});

const adminProductPayloadSchema = z
  .object({
    name: safeTextSchema({ min: 2, max: 160 }),
    code: safeTextSchema({ min: 2, max: 80 }),
    description: safeTextSchema({ max: 2_000 }).nullable().optional(),
    priceInCents: z.number().int().min(0).max(2_000_000_000),
    compareAtCents: z.number().int().min(0).max(2_000_000_000).nullable(),
    line: productLineSchema.nullable(),
    lineId: customLineIdSchema,
    status: productStatusSchema,
    clubId: z.string().min(1).max(60).nullable(),
    allowsCustomPrint: z.boolean(),
    isFeatured: z.boolean(),
    showStock: z.boolean().default(false),
    images: z.array(productImageSchema).max(20),
    variants: z.array(productVariantSchema).max(100),
  })
  .superRefine((input, ctx) => {
    const combinations = new Set<string>();
    input.variants.forEach((variant, index) => {
      const combination = `${variant.size.toLocaleLowerCase()}\u0000${variant.color.toLocaleLowerCase()}`;
      if (combinations.has(combination)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["variants", index, "size"],
          message: "No puede repetirse la misma combinación de talle y color.",
        });
      }
      combinations.add(combination);
      if (input.showStock && variant.stock === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["variants", index, "stock"],
          message:
            "Con stock limitado, cada combinación necesita su cantidad (puede ser 0).",
        });
      }
    });
    if (input.status === "PUBLISHED" && input.variants.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["variants"],
        message: "Para publicar el producto agregá al menos un talle.",
      });
    }
  })
  // Por encargo no se controla inventario: el stock se guarda vacío.
  .transform((input) =>
    input.showStock
      ? input
      : {
          ...input,
          variants: input.variants.map((variant) => ({
            ...variant,
            stock: null,
          })),
        },
  );

export const createAdminProductInputSchema = adminProductPayloadSchema;

export const updateAdminProductInputSchema = adminProductPayloadSchema.and(
  z.object({ id: z.string().min(1).max(60) }),
);

export const duplicateAdminProductInputSchema = z.object({
  id: z.string().min(1).max(60),
});

export const quickUpdateAdminProductInputSchema = z.object({
  id: z.string().min(1).max(60),
  priceInCents: z.number().int().min(0).max(2_000_000_000).optional(),
  status: productStatusSchema.exclude(["OUT_OF_STOCK"]).optional(),
  variantStocks: z
    .array(
      z.object({
        id: z.string().min(1).max(60),
        stock: z.number().int().min(0).max(1_000_000),
      }),
    )
    .max(100)
    .optional(),
});

export const deleteAdminProductInputSchema = z.object({
  id: z.string().min(1).max(60),
});

export const publishApprovedDesignInputSchema = z.object({
  designId: z.string().min(1).max(60),
  name: safeTextSchema({ min: 2, max: 160 }),
  priceInCents: z.number().int().min(0).max(2_000_000_000),
  stock: z.number().int().min(0).max(1_000_000).nullable(),
});

export const createCatalogLineInputSchema = z.object({
  name: safeTextSchema({ min: 2, max: 80 }),
  description: safeTextSchema({ max: 240 }).nullable().optional(),
});
