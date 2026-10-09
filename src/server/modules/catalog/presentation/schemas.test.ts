import { describe, expect, it } from "vitest";

import {
  createAdminProductInputSchema,
  listProductsInputSchema,
  quickUpdateAdminProductInputSchema,
  updateAdminProductInputSchema,
} from "./schemas";

const validProduct = {
  name: "Remera entrenamiento",
  code: "REM-100",
  description: "Tela deportiva",
  priceInCents: 2_450_000,
  compareAtCents: null,
  line: "TRAINING" as const,
  status: "PUBLISHED" as const,
  clubId: null,
  allowsCustomPrint: true,
  isFeatured: false,
  images: [
    {
      url: "/images/remera.png",
      alt: "Remera negra",
      color: "Negro",
    },
  ],
  variants: [{ size: "M", color: "Negro", stock: 10, sku: "REM-100-NEGRO-M" }],
};

describe("createAdminProductInputSchema", () => {
  it("accepts a complete product", () => {
    expect(createAdminProductInputSchema.safeParse(validProduct).success).toBe(
      true,
    );
  });

  it("rejects executable image URLs and scripts in text", () => {
    const result = createAdminProductInputSchema.safeParse({
      ...validProduct,
      name: "<script>alert(1)</script>",
      images: [{ url: "javascript:alert(1)", alt: null, color: null }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate size and color combinations", () => {
    const result = createAdminProductInputSchema.safeParse({
      ...validProduct,
      variants: [
        ...validProduct.variants,
        { size: "m", color: "negro", stock: 4, sku: "OTRO-SKU" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("con stock limitado exige la cantidad de cada variante", () => {
    const result = createAdminProductInputSchema.safeParse({
      ...validProduct,
      showStock: true,
      variants: [
        { size: "M", color: "Negro", stock: 0, sku: null },
        { size: "L", color: "Negro", stock: null, sku: null },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["variants", 1, "stock"]);
  });

  it("por encargo guarda el stock vacío", () => {
    const result = createAdminProductInputSchema.parse({
      ...validProduct,
      showStock: false,
    });
    expect(result.variants[0]?.stock).toBeNull();
  });

  it("no publica productos sin variantes pero permite borradores", () => {
    expect(
      createAdminProductInputSchema.safeParse({ ...validProduct, variants: [] })
        .success,
    ).toBe(false);
    expect(
      createAdminProductInputSchema.safeParse({
        ...validProduct,
        status: "DRAFT",
        variants: [],
      }).success,
    ).toBe(true);
  });

  it("la edición conserva el id y aplica las mismas reglas", () => {
    const result = updateAdminProductInputSchema.parse({
      ...validProduct,
      id: "prod-1",
      showStock: true,
    });
    expect(result.id).toBe("prod-1");
    expect(result.variants[0]?.stock).toBe(10);
  });
});

describe("quickUpdateAdminProductInputSchema", () => {
  it("acepta precio, visibilidad y stock por variante", () => {
    expect(
      quickUpdateAdminProductInputSchema.safeParse({
        id: "prod-1",
        priceInCents: 1000,
        status: "PUBLISHED",
        variantStocks: [{ id: "v1", stock: 3 }],
      }).success,
    ).toBe(true);
  });

  it("rechaza stock negativo y el estado interno Sin stock", () => {
    expect(
      quickUpdateAdminProductInputSchema.safeParse({
        id: "prod-1",
        variantStocks: [{ id: "v1", stock: -1 }],
      }).success,
    ).toBe(false);
    expect(
      quickUpdateAdminProductInputSchema.safeParse({
        id: "prod-1",
        status: "OUT_OF_STOCK",
      }).success,
    ).toBe(false);
  });
});

describe("listProductsInputSchema", () => {
  it("shows only available products by default and allows admin overrides", () => {
    expect(listProductsInputSchema.parse({}).availableOnly).toBe(true);
    expect(
      listProductsInputSchema.parse({ availableOnly: false }).availableOnly,
    ).toBe(false);
  });
});
