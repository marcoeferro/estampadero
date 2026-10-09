import { describe, expect, it } from "vitest";

import {
  addColor,
  addSizes,
  draftFromProduct,
  emptyProductDraft,
  fillStock,
  moveItem,
  NO_COLOR,
  nextDraftAfterSave,
  orderedVariants,
  removeColor,
  removeSize,
  stockErrorKey,
  tabForErrors,
  toggleCombination,
  toProductPayload,
  updateVariant,
  validateProductDraft,
  type ProductDraft,
} from "./product-draft";

function baseDraft(overrides: Partial<ProductDraft> = {}): ProductDraft {
  return {
    ...emptyProductDraft(),
    name: "Remera básica",
    code: "REM-01",
    price: "15000",
    ...overrides,
  };
}

describe("grilla de talles y colores", () => {
  it("crea una variante por talle cuando el producto no tiene colores", () => {
    const draft = addSizes(baseDraft(), ["S", "M", "m", " L "]);
    expect(draft.sizes).toEqual(["S", "M", "L"]);
    expect(
      draft.variants.map((variant) => [variant.size, variant.color]),
    ).toEqual([
      ["S", NO_COLOR],
      ["M", NO_COLOR],
      ["L", NO_COLOR],
    ]);
  });

  it("el primer color reemplaza la columna sin color y conserva el stock", () => {
    let draft = addSizes(baseDraft({ showStock: true }), ["S", "M"]);
    draft = updateVariant(draft, "S", NO_COLOR, { stock: "4" });
    draft = addColor(draft, "Negro");
    expect(draft.colors).toEqual(["Negro"]);
    expect(draft.variants).toEqual([
      { size: "S", color: "Negro", stock: "4", sku: "" },
      { size: "M", color: "Negro", stock: "", sku: "" },
    ]);
  });

  it("un color nuevo agrega todas sus combinaciones", () => {
    let draft = addSizes(baseDraft(), ["S", "M"]);
    draft = addColor(addColor(draft, "Negro"), "Blanco");
    expect(orderedVariants(draft).map((v) => `${v.size}/${v.color}`)).toEqual([
      "S/Negro",
      "S/Blanco",
      "M/Negro",
      "M/Blanco",
    ]);
  });

  it("no permite agregar 'Sin definir' ni colores repetidos", () => {
    const draft = addColor(addSizes(baseDraft(), ["S"]), "Negro");
    expect(addColor(draft, "negro")).toBe(draft);
    expect(addColor(draft, NO_COLOR)).toBe(draft);
  });

  it("al quitar el último color el producto vuelve a ser sin color", () => {
    let draft = addColor(addSizes(baseDraft(), ["S"]), "Rojo");
    draft = updateVariant(draft, "S", "Rojo", { stock: "3", sku: "ROJO-S" });
    draft = removeColor(draft, "Rojo");
    expect(draft.colors).toEqual([]);
    expect(draft.variants).toEqual([
      { size: "S", color: NO_COLOR, stock: "3", sku: "ROJO-S" },
    ]);
  });

  it("quitar un talle elimina sus combinaciones", () => {
    let draft = addColor(addSizes(baseDraft(), ["S", "M"]), "Negro");
    draft = removeSize(draft, "s");
    expect(draft.sizes).toEqual(["M"]);
    expect(draft.variants).toHaveLength(1);
  });

  it("desactiva y reactiva una combinación puntual", () => {
    let draft = addColor(
      addColor(addSizes(baseDraft(), ["S"]), "Negro"),
      "Rojo",
    );
    draft = toggleCombination(draft, "S", "Rojo");
    expect(draft.variants.map((variant) => variant.color)).toEqual(["Negro"]);
    draft = toggleCombination(draft, "S", "Rojo");
    expect(draft.variants.map((variant) => variant.color)).toEqual([
      "Negro",
      "Rojo",
    ]);
  });

  it("carga el mismo stock en todas las combinaciones", () => {
    const draft = fillStock(addSizes(baseDraft(), ["S", "M"]), "10");
    expect(draft.variants.every((variant) => variant.stock === "10")).toBe(
      true,
    );
  });
});

describe("validación por campo", () => {
  it("marca cada campo con su propio mensaje", () => {
    const errors = validateProductDraft(
      baseDraft({ name: "", code: "", price: "abc", status: "PUBLISHED" }),
    );
    expect(errors.name).toBeTruthy();
    expect(errors.code).toBeTruthy();
    expect(errors.price).toBeTruthy();
    expect(errors.sizes).toBeTruthy();
    expect(tabForErrors(errors)).toBe("information");
  });

  it("permite guardar un borrador sin talles", () => {
    expect(validateProductDraft(baseDraft())).toEqual({});
  });

  it("exige que el precio anterior sea mayor al actual", () => {
    const errors = validateProductDraft(baseDraft({ compareAtPrice: "10000" }));
    expect(errors.compareAtPrice).toMatch(/mayor/);
  });

  it("con stock limitado exige cantidad en cada combinación", () => {
    let draft = addSizes(baseDraft({ showStock: true }), ["S", "M"]);
    draft = updateVariant(draft, "S", NO_COLOR, { stock: "0" });
    const errors = validateProductDraft(draft);
    expect(errors[stockErrorKey("S", NO_COLOR)]).toBeUndefined();
    expect(errors[stockErrorKey("M", NO_COLOR)]).toBe("Cargá el stock.");
    expect(errors.variants).toBeTruthy();
    expect(tabForErrors(errors)).toBe("variants");
  });

  it("por encargo no pide stock", () => {
    const draft = addSizes(baseDraft({ status: "PUBLISHED" }), ["S"]);
    expect(validateProductDraft(draft)).toEqual({});
  });

  it("rechaza stock negativo o con decimales", () => {
    let draft = addSizes(baseDraft({ showStock: true }), ["S"]);
    draft = updateVariant(draft, "S", NO_COLOR, { stock: "1.5" });
    expect(validateProductDraft(draft)[stockErrorKey("S", NO_COLOR)]).toMatch(
      /entero/,
    );
  });
});

describe("payload y borradores", () => {
  it("por encargo envía el stock vacío aunque haya valores cargados", () => {
    let draft = addSizes(baseDraft(), ["S"]);
    draft = updateVariant(draft, "S", NO_COLOR, { stock: "5" });
    expect(toProductPayload(draft).variants[0]?.stock).toBeNull();
    expect(
      toProductPayload({ ...draft, showStock: true }).variants[0]?.stock,
    ).toBe(5);
  });

  it("convierte precios a centavos y limpia textos", () => {
    const payload = toProductPayload(
      baseDraft({ price: "1234.56", compareAtPrice: "", description: "  " }),
    );
    expect(payload.priceInCents).toBe(123456);
    expect(payload.compareAtCents).toBeNull();
    expect(payload.description).toBeNull();
  });

  it("'Guardar y crear otro' conserva línea, socio y modalidad", () => {
    const next = nextDraftAfterSave(
      addSizes(
        baseDraft({ line: "URBANA", clubId: "club-1", showStock: true }),
        ["S"],
      ),
    );
    expect(next).toMatchObject({
      name: "",
      code: "",
      line: "URBANA",
      clubId: "club-1",
      showStock: true,
      sizes: [],
      variants: [],
    });
  });

  it("reconstruye talles y colores de un producto guardado", () => {
    const draft = draftFromProduct({
      id: "p1",
      name: "Buzo",
      code: "BUZ",
      description: null,
      priceInCents: 2500000,
      compareAtCents: null,
      line: null,
      lineId: null,
      status: "OUT_OF_STOCK",
      club: null,
      allowsCustomPrint: false,
      isFeatured: false,
      showStock: true,
      images: [],
      variants: [
        { id: "v1", size: "M", color: "Negro", stock: 2, sku: "A" },
        { id: "v2", size: "L", color: "Negro", stock: null, sku: "B" },
        { id: "v3", size: "M", color: NO_COLOR, stock: 1, sku: "C" },
      ],
    });
    expect(draft.status).toBe("DRAFT");
    expect(draft.sizes).toEqual(["M", "L"]);
    expect(draft.colors).toEqual(["Negro", NO_COLOR]);
    expect(orderedVariants(draft)).toHaveLength(3);
    expect(draft.variants[1]?.stock).toBe("");
  });

  it("mueve imágenes dentro de la lista", () => {
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });
});
