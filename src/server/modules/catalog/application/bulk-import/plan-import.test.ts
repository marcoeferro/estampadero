import { describe, expect, it } from "vitest";

import { columnForHeader, MAX_IMPORT_ROWS } from "./columns";
import {
  NO_COLOR,
  parsePriceToCents,
  parseStock,
  planImport,
  type ImportContext,
  type ImportRow,
} from "./plan-import";

const context: ImportContext = {
  categories: [{ id: "cat-remeras", name: "Remeras", slug: "remeras" }],
  lines: [
    { id: "line-egresados", name: "Egresados 2026", slug: "egresados-2026" },
  ],
  clubs: [
    {
      id: "club-activo",
      name: "Club Atlético",
      slug: "club-atletico",
      hasActiveAgreement: true,
      canSell: true,
    },
    {
      id: "club-sin-cobros",
      name: "Escuela N°14",
      slug: "escuela-14",
      hasActiveAgreement: true,
      canSell: false,
    },
    {
      id: "club-sin-convenio",
      name: "Club Viejo",
      slug: "club-viejo",
      hasActiveAgreement: false,
      canSell: false,
    },
  ],
  existingProducts: [
    {
      id: "prod-existente",
      code: "BUZ-1",
      clubId: null,
      showStock: true,
      variants: [
        { id: "var-m", size: "M", color: "Negro", stock: 3 },
        { id: "var-l", size: "L", color: "Negro", stock: 5 },
      ],
    },
    {
      id: "prod-encargo",
      code: "GOR-1",
      clubId: null,
      showStock: false,
      variants: [{ id: "var-u", size: "Único", color: NO_COLOR, stock: null }],
    },
  ],
};

let nextRow = 2;
function row(values: ImportRow["values"]): ImportRow {
  return { rowNumber: nextRow++, values };
}
function rows(...items: ImportRow["values"][]) {
  nextRow = 2;
  return items.map(row);
}

const remera = {
  code: "REM-1",
  name: "Remera",
  price: "15000",
};

describe("lectura de valores", () => {
  it("interpreta precios con formato argentino y con punto decimal", () => {
    expect(parsePriceToCents("15000")).toBe(1_500_000);
    expect(parsePriceToCents("15.000")).toBe(1_500_000);
    expect(parsePriceToCents("$ 15.000,50")).toBe(1_500_050);
    expect(parsePriceToCents("1500.5")).toBe(150_050);
    expect(parsePriceToCents("abc")).toBeNull();
    expect(parsePriceToCents("-10")).toBeNull();
  });

  it("acepta solo stock entero y no negativo", () => {
    expect(parseStock("0")).toBe(0);
    expect(parseStock("12")).toBe(12);
    expect(parseStock("12.0")).toBe(12);
    expect(parseStock("1.5")).toBeNull();
    expect(parseStock("-1")).toBeNull();
  });

  it("reconoce encabezados con o sin tildes ni mayúsculas", () => {
    expect(columnForHeader("Código")).toBe("code");
    expect(columnForHeader("PRECIO ANTERIOR")).toBe("compareAtPrice");
    expect(columnForHeader("categoria")).toBe("category");
    expect(columnForHeader("Otra cosa")).toBeNull();
  });
});

describe("planImport · productos nuevos", () => {
  it("agrupa las filas por código y crea una variante por fila", () => {
    const plan = planImport(
      rows(
        { ...remera, size: "S", color: "Negro" },
        { code: "REM-1", size: "M", color: "Negro" },
        { code: "rem-1", size: "M", color: "Blanco" },
      ),
      context,
    );
    expect(plan.errors).toEqual([]);
    expect(plan.products).toHaveLength(1);
    const [product] = plan.products;
    expect(product).toMatchObject({
      code: "REM-1",
      action: "create",
      rowNumbers: [2, 3, 4],
      fields: {
        name: "Remera",
        priceInCents: 1_500_000,
        status: "DRAFT",
        showStock: false,
        compareAtCents: null,
        description: null,
      },
    });
    expect(
      product!.variants.map((v) => `${v.size}/${v.color}/${v.stock}`),
    ).toEqual(["S/Negro/null", "M/Negro/null", "M/Blanco/null"]);
  });

  it("usa 'Sin definir' cuando no hay color", () => {
    const plan = planImport(rows({ ...remera, size: "Único" }), context);
    expect(plan.products[0]?.variants[0]?.color).toBe(NO_COLOR);
  });

  it("con stock en alguna fila pasa a stock limitado y lo exige en todas", () => {
    const plan = planImport(
      rows({ ...remera, size: "S", stock: "4" }, { code: "REM-1", size: "M" }),
      context,
    );
    expect(plan.products).toEqual([]);
    expect(plan.errors.map((issue) => issue.rowNumber)).toEqual([2, 3]);
    expect(plan.errors[0]?.message).toMatch(/fila 3/);
    expect(plan.errors[1]?.message).toMatch(/Falta el stock/);
  });

  it("carga stock limitado cuando todas las filas lo traen", () => {
    const plan = planImport(
      rows(
        { ...remera, size: "S", stock: "4" },
        { code: "REM-1", size: "M", stock: "0" },
      ),
      context,
    );
    expect(plan.products[0]?.fields.showStock).toBe(true);
    expect(plan.products[0]?.variants.map((v) => v.stock)).toEqual([4, 0]);
  });

  it("resuelve categoría, línea propia y club por nombre o slug", () => {
    const plan = planImport(
      rows({
        ...remera,
        size: "M",
        category: "remeras",
        line: "Egresados 2026",
        club: "club-atletico",
        status: "Publicado",
      }),
      context,
    );
    expect(plan.errors).toEqual([]);
    expect(plan.products[0]?.fields).toMatchObject({
      categoryId: "cat-remeras",
      line: null,
      lineId: "line-egresados",
      clubId: "club-activo",
      status: "PUBLISHED",
    });
  });

  it("acepta las líneas fijas sin importar mayúsculas", () => {
    const plan = planImport(
      rows({ ...remera, size: "M", line: "TRAINING" }),
      context,
    );
    expect(plan.products[0]?.fields).toMatchObject({
      line: "TRAINING",
      lineId: null,
    });
  });

  it("no publica productos de clubes sin cobros activos", () => {
    const plan = planImport(
      rows({ ...remera, size: "M", club: "Escuela N°14", status: "Publicado" }),
      context,
    );
    expect(plan.products).toEqual([]);
    expect(plan.errors[0]?.message).toMatch(/cobros activos/);
    const draft = planImport(
      rows({ ...remera, size: "M", club: "Escuela N°14" }),
      context,
    );
    expect(draft.products[0]?.fields).toMatchObject({
      clubId: "club-sin-cobros",
      status: "DRAFT",
    });
  });

  it("informa cada error con su fila y su motivo", () => {
    const plan = planImport(
      rows(
        { code: "A-1", price: "100", size: "M" },
        { code: "B-1", name: "Buzo", price: "gratis", size: "M" },
        { code: "C-1", name: "Gorra", price: "100" },
        {
          code: "D-1",
          name: "Short",
          price: "100",
          size: "M",
          club: "Club Viejo",
        },
        {
          code: "E-1",
          name: "Media",
          price: "100",
          size: "M",
          category: "Zapatos",
        },
        {
          code: "F-1",
          name: "Musculosa",
          price: "100",
          size: "M",
          status: "quizás",
        },
        { name: "Sin código", price: "100", size: "M" },
        { code: "G-1", name: "<script>x</script>", price: "100", size: "M" },
        {
          code: "H-1",
          name: "Campera",
          price: "100",
          compareAtPrice: "50",
          size: "M",
        },
      ),
      context,
    );
    expect(plan.products).toEqual([]);
    expect(
      plan.errors.map((issue) => [issue.rowNumber, issue.message]),
    ).toEqual([
      [2, "Falta el nombre del producto."],
      [3, 'Precio inválido: "gratis".'],
      [4, 'Falta el talle (si la prenda no tiene, escribí "Único").'],
      [5, "Club Viejo no tiene un convenio activo."],
      [6, 'No existe la categoría "Zapatos".'],
      [7, 'Estado inválido: "quizás". Usá Publicado o No publicado.'],
      [8, "Falta el código del producto."],
      [9, "Nombre: no se permiten etiquetas HTML ni código."],
      [10, "El precio anterior tiene que ser mayor al precio."],
    ]);
  });

  it("detecta talle y color repetidos y datos contradictorios", () => {
    const plan = planImport(
      rows(
        { ...remera, size: "M", color: "Negro" },
        { code: "REM-1", size: "m", color: "negro" },
        { code: "REM-1", price: "20000", size: "L" },
      ),
      context,
    );
    expect(plan.products).toEqual([]);
    expect(plan.errors.map((issue) => issue.message)).toEqual([
      "Se omite porque el producto tiene errores (ver fila 4).",
      "Talle y color repetidos (ya están en la fila 2).",
      "Precio distinto al de la fila 2 para el mismo código.",
    ]);
  });

  it("carga las filas correctas aunque otras tengan error", () => {
    const plan = planImport(
      rows(
        { ...remera, size: "M" },
        { code: "MAL-1", name: "Mal", price: "x", size: "M" },
        { code: "BIEN-2", name: "Otra", price: "100", size: "L" },
      ),
      context,
    );
    expect(plan.products.map((product) => product.code)).toEqual([
      "REM-1",
      "BIEN-2",
    ]);
    expect(plan.errors).toHaveLength(1);
  });

  it("ignora filas vacías y rechaza planillas vacías o demasiado grandes", () => {
    expect(
      planImport(rows({ ...remera, size: "M" }, {}, { code: " " }), context)
        .totalRows,
    ).toBe(1);
    expect(planImport([], context).errors[0]?.message).toMatch(
      /no tiene filas/,
    );
    const tooMany = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, index) => ({
      rowNumber: index + 2,
      values: { code: `P-${index}`, name: "Producto", price: "1", size: "M" },
    }));
    const plan = planImport(tooMany, context);
    expect(plan.products).toEqual([]);
    expect(plan.errors[0]?.message).toMatch(/máximo es 1000/);
  });

  it("procesa una planilla de 200 filas válidas", () => {
    const sizes = ["S", "M", "L", "XL"];
    const many = Array.from({ length: 200 }, (_, index) => ({
      rowNumber: index + 2,
      values: {
        code: `PROD-${Math.floor(index / 4)}`,
        name: `Producto ${Math.floor(index / 4)}`,
        price: "9.990",
        size: sizes[index % 4],
        stock: "5",
      },
    }));
    const plan = planImport(many, context);
    expect(plan.errors).toEqual([]);
    expect(plan.products).toHaveLength(50);
    expect(
      plan.products.every((product) => product.variants.length === 4),
    ).toBe(true);
  });
});

describe("planImport · productos existentes", () => {
  it("actualiza por código sin duplicar y deja intactas las columnas vacías", () => {
    const plan = planImport(
      rows(
        { code: "buz-1", size: "M", color: "Negro", stock: "10" },
        { code: "BUZ-1", size: "XL", color: "Negro", stock: "2" },
      ),
      context,
    );
    expect(plan.errors).toEqual([]);
    const [product] = plan.products;
    expect(product).toMatchObject({
      action: "update",
      existingId: "prod-existente",
      fields: { showStock: true },
    });
    expect(product!.fields).not.toHaveProperty("name");
    expect(product!.fields).not.toHaveProperty("status");
    expect(product!.fields).not.toHaveProperty("priceInCents");
    expect(product!.variants).toEqual([
      {
        rowNumber: 2,
        size: "M",
        color: "Negro",
        stock: 10,
        existingId: "var-m",
      },
      { rowNumber: 3, size: "XL", color: "Negro", stock: 2, existingId: null },
    ]);
  });

  it("conserva el stock actual si la fila de una variante existente lo deja vacío", () => {
    const plan = planImport(
      rows({ code: "BUZ-1", price: "30000", size: "L", color: "Negro" }),
      context,
    );
    expect(plan.products[0]?.variants[0]).toMatchObject({
      existingId: "var-l",
      stock: undefined,
    });
    expect(plan.products[0]?.fields.priceInCents).toBe(3_000_000);
  });

  it("exige stock para variantes nuevas de un producto con stock", () => {
    const plan = planImport(
      rows({ code: "BUZ-1", size: "XXL", color: "Negro" }),
      context,
    );
    expect(plan.errors[0]?.message).toMatch(/Falta el stock/);
  });

  it("para pasar un producto por encargo a stock pide todas sus variantes", () => {
    const plan = planImport(
      rows({ code: "GOR-1", size: "Grande", stock: "3" }),
      context,
    );
    expect(plan.products).toEqual([]);
    expect(plan.errors[0]?.message).toMatch(
      /incluí también las variantes Único/,
    );
    const ok = planImport(
      rows(
        { code: "GOR-1", size: "Único", stock: "3" },
        { code: "GOR-1", size: "Grande", stock: "1" },
      ),
      context,
    );
    expect(ok.errors).toEqual([]);
    expect(ok.products[0]?.fields.showStock).toBe(true);
  });

  it("subir dos veces la misma planilla planifica actualizaciones", () => {
    const sheet = rows({ ...remera, size: "M" });
    const first = planImport(sheet, context);
    expect(first.products[0]?.action).toBe("create");
    const afterFirstLoad: ImportContext = {
      ...context,
      existingProducts: [
        ...context.existingProducts,
        {
          id: "prod-rem",
          code: "REM-1",
          clubId: null,
          showStock: false,
          variants: [
            { id: "var-rem-m", size: "M", color: NO_COLOR, stock: null },
          ],
        },
      ],
    };
    const second = planImport(sheet, afterFirstLoad);
    expect(second.products[0]).toMatchObject({
      action: "update",
      existingId: "prod-rem",
    });
    expect(second.products[0]?.variants[0]?.existingId).toBe("var-rem-m");
  });
});
