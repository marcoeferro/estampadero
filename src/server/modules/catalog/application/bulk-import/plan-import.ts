import { containsExecutableContent } from "elestampadero/server/security/safe-text";

import { MAX_IMPORT_ROWS, type ImportColumnKey } from "./columns";

export type ProductLineValue =
  "CLUB" | "URBANA" | "TRAINING" | "TRABAJO" | "ESCOLAR";

export const NO_COLOR = "Sin definir";

export interface ImportRow {
  /** Número de fila en la planilla (la fila 1 es el encabezado). */
  rowNumber: number;
  values: Partial<Record<ImportColumnKey, string>>;
}

export interface ImportContext {
  categories: { id: string; name: string; slug: string }[];
  lines: { id: string; name: string; slug: string }[];
  clubs: {
    id: string;
    name: string;
    slug: string;
    hasActiveAgreement: boolean;
    canSell: boolean;
  }[];
  existingProducts: {
    id: string;
    code: string;
    clubId: string | null;
    showStock: boolean;
    variants: {
      id: string;
      size: string;
      color: string;
      stock: number | null;
    }[];
  }[];
}

export interface PlannedVariant {
  rowNumber: number;
  size: string;
  color: string;
  /** `undefined` conserva el stock actual de una variante existente. */
  stock: number | null | undefined;
  existingId: string | null;
}

export interface PlannedProduct {
  code: string;
  action: "create" | "update";
  existingId: string | null;
  rowNumbers: number[];
  /** En una actualización, los campos `undefined` no se modifican. */
  fields: {
    name?: string;
    description?: string | null;
    priceInCents?: number;
    compareAtCents?: number | null;
    categoryId?: string | null;
    line?: ProductLineValue | null;
    lineId?: string | null;
    clubId?: string | null;
    status?: "DRAFT" | "PUBLISHED";
    showStock: boolean;
  };
  variants: PlannedVariant[];
}

export interface RowIssue {
  rowNumber: number;
  code: string | null;
  message: string;
}

export interface ImportPlan {
  totalRows: number;
  products: PlannedProduct[];
  errors: RowIssue[];
}

const LINE_LABELS: Record<string, ProductLineValue> = {
  club: "CLUB",
  urbana: "URBANA",
  training: "TRAINING",
  trabajo: "TRABAJO",
  escolar: "ESCOLAR",
};

function key(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

function clean(value: string | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Interpreta precios escritos a la argentina (15.000,50) o con punto decimal
 * (15000.5). Devuelve centavos o null si no es un número válido.
 */
export function parsePriceToCents(raw: string): number | null {
  let value = raw.replace(/\$|\s/g, "");
  if (!value) return null;
  if (value.includes(",")) {
    value = value.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(value)) {
    value = value.replace(/\./g, "");
  }
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const cents = Math.round(Number(value) * 100);
  return Number.isSafeInteger(cents) && cents <= 2_000_000_000 ? cents : null;
}

export function parseStock(raw: string): number | null {
  const value = raw.replace(/\s/g, "");
  if (!/^\d+(\.0+)?$/.test(value)) return null;
  const stock = Number(value);
  return stock <= 1_000_000 ? stock : null;
}

function parseStatus(raw: string): "DRAFT" | "PUBLISHED" | null {
  const value = key(raw);
  if (["publicado", "publicar", "si", "visible", "activo"].includes(value)) {
    return "PUBLISHED";
  }
  if (
    ["no publicado", "borrador", "no", "oculto", "inactivo"].includes(value)
  ) {
    return "DRAFT";
  }
  return null;
}

function textError(
  label: string,
  value: string,
  { min = 0, max }: { min?: number; max: number },
) {
  if (value.length < min)
    return `${label}: tiene que tener al menos ${min} caracteres.`;
  if (value.length > max)
    return `${label}: no puede superar los ${max} caracteres.`;
  if (containsExecutableContent(value)) {
    return `${label}: no se permiten etiquetas HTML ni código.`;
  }
  return null;
}

/**
 * Valida las filas de la planilla y arma el plan de carga. No toca la base de
 * datos: recibe los datos de referencia en `context`. Un producto con alguna
 * fila inválida se omite completo; el resto se carga igual.
 */
export function planImport(
  rows: ImportRow[],
  context: ImportContext,
): ImportPlan {
  const errors: RowIssue[] = [];
  const dataRows = rows.filter((row) =>
    Object.values(row.values).some((value) => clean(value) !== ""),
  );

  if (dataRows.length === 0) {
    return {
      totalRows: 0,
      products: [],
      errors: [
        {
          rowNumber: 0,
          code: null,
          message: "La planilla no tiene filas con datos.",
        },
      ],
    };
  }
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return {
      totalRows: dataRows.length,
      products: [],
      errors: [
        {
          rowNumber: 0,
          code: null,
          message: `La planilla tiene ${dataRows.length} filas y el máximo es ${MAX_IMPORT_ROWS}. Dividila en varios archivos.`,
        },
      ],
    };
  }

  const existingByCode = new Map(
    context.existingProducts.map((product) => [key(product.code), product]),
  );
  const groups = new Map<string, ImportRow[]>();
  for (const row of dataRows) {
    const code = clean(row.values.code);
    if (!code) {
      errors.push({
        rowNumber: row.rowNumber,
        code: null,
        message: "Falta el código del producto.",
      });
      continue;
    }
    const group = groups.get(key(code)) ?? [];
    group.push(row);
    groups.set(key(code), group);
  }

  const products: PlannedProduct[] = [];
  for (const groupRows of groups.values()) {
    const result = planProduct(groupRows, context, existingByCode);
    if ("errors" in result) {
      errors.push(...result.errors);
      const failedRows = new Set(result.errors.map((issue) => issue.rowNumber));
      const firstFailed = result.errors[0]!.rowNumber;
      for (const row of groupRows) {
        if (!failedRows.has(row.rowNumber)) {
          errors.push({
            rowNumber: row.rowNumber,
            code: clean(row.values.code),
            message: `Se omite porque el producto tiene errores (ver fila ${firstFailed}).`,
          });
        }
      }
    } else {
      products.push(result.product);
    }
  }

  errors.sort((a, b) => a.rowNumber - b.rowNumber);
  return { totalRows: dataRows.length, products, errors };
}

function planProduct(
  rows: ImportRow[],
  context: ImportContext,
  existingByCode: Map<string, ImportContext["existingProducts"][number]>,
): { product: PlannedProduct } | { errors: RowIssue[] } {
  const code = clean(rows[0]!.values.code);
  const existing = existingByCode.get(key(code)) ?? null;
  const issues: RowIssue[] = [];
  const fail = (rowNumber: number, message: string) =>
    issues.push({ rowNumber, code, message });

  const codeError = textError("Código", code, { min: 2, max: 80 });
  if (codeError) fail(rows[0]!.rowNumber, codeError);

  /**
   * Toma el primer valor no vacío de una columna y avisa si otra fila del
   * mismo producto trae un valor distinto.
   */
  function productValue(column: ImportColumnKey, label: string) {
    let found: { value: string; rowNumber: number } | null = null;
    for (const row of rows) {
      const value = clean(row.values[column]);
      if (!value) continue;
      if (!found) {
        found = { value, rowNumber: row.rowNumber };
      } else if (key(value) !== key(found.value)) {
        fail(
          row.rowNumber,
          `${label} distinto al de la fila ${found.rowNumber} para el mismo código.`,
        );
      }
    }
    return found;
  }

  const fields: PlannedProduct["fields"] = { showStock: false };

  const name = productValue("name", "Nombre");
  if (name) {
    const error = textError("Nombre", name.value, { min: 2, max: 160 });
    if (error) fail(name.rowNumber, error);
    else fields.name = name.value;
  } else if (!existing) {
    fail(rows[0]!.rowNumber, "Falta el nombre del producto.");
  }

  const description = productValue("description", "Descripción");
  if (description) {
    const error = textError("Descripción", description.value, { max: 2000 });
    if (error) fail(description.rowNumber, error);
    else fields.description = description.value;
  } else if (!existing) {
    fields.description = null;
  }

  const price = productValue("price", "Precio");
  if (price) {
    const cents = parsePriceToCents(price.value);
    if (cents === null)
      fail(price.rowNumber, `Precio inválido: "${price.value}".`);
    else fields.priceInCents = cents;
  } else if (!existing) {
    fail(rows[0]!.rowNumber, "Falta el precio del producto.");
  }

  const compareAt = productValue("compareAtPrice", "Precio anterior");
  if (compareAt) {
    const cents = parsePriceToCents(compareAt.value);
    if (cents === null) {
      fail(
        compareAt.rowNumber,
        `Precio anterior inválido: "${compareAt.value}".`,
      );
    } else if (
      fields.priceInCents !== undefined &&
      cents <= fields.priceInCents
    ) {
      fail(
        compareAt.rowNumber,
        "El precio anterior tiene que ser mayor al precio.",
      );
    } else {
      fields.compareAtCents = cents;
    }
  } else if (!existing) {
    fields.compareAtCents = null;
  }

  const category = productValue("category", "Categoría");
  if (category) {
    const match = context.categories.find(
      (candidate) =>
        key(candidate.name) === key(category.value) ||
        key(candidate.slug) === key(category.value),
    );
    if (!match)
      fail(category.rowNumber, `No existe la categoría "${category.value}".`);
    else fields.categoryId = match.id;
  }

  const line = productValue("line", "Línea");
  if (line) {
    const builtIn = LINE_LABELS[key(line.value)];
    const custom = context.lines.find(
      (candidate) =>
        key(candidate.name) === key(line.value) ||
        key(candidate.slug) === key(line.value),
    );
    if (builtIn) {
      fields.line = builtIn;
      fields.lineId = null;
    } else if (custom) {
      fields.line = null;
      fields.lineId = custom.id;
    } else {
      fail(line.rowNumber, `No existe la línea "${line.value}".`);
    }
  }

  const club = productValue("club", "Club");
  let clubCanSell = true;
  if (club) {
    const match = context.clubs.find(
      (candidate) =>
        key(candidate.name) === key(club.value) ||
        key(candidate.slug) === key(club.value),
    );
    if (!match) {
      fail(club.rowNumber, `No existe el club "${club.value}".`);
    } else if (!match.hasActiveAgreement) {
      fail(club.rowNumber, `${match.name} no tiene un convenio activo.`);
    } else {
      fields.clubId = match.id;
      clubCanSell = match.canSell;
    }
  } else if (existing?.clubId) {
    clubCanSell =
      context.clubs.find((candidate) => candidate.id === existing.clubId)
        ?.canSell ?? false;
  }

  const status = productValue("status", "Estado");
  if (status) {
    const parsed = parseStatus(status.value);
    if (!parsed) {
      fail(
        status.rowNumber,
        `Estado inválido: "${status.value}". Usá Publicado o No publicado.`,
      );
    } else if (parsed === "PUBLISHED" && !clubCanSell) {
      fail(
        status.rowNumber,
        "El club todavía no tiene los cobros activos en Mobbex: cargalo como No publicado.",
      );
    } else {
      fields.status = parsed;
    }
  } else if (!existing) {
    fields.status = "DRAFT";
  }

  // Variantes
  const anyStock = rows.some((row) => clean(row.values.stock) !== "");
  const showStock = anyStock || (existing?.showStock ?? false);
  fields.showStock = showStock;

  const variants: PlannedVariant[] = [];
  const seen = new Map<string, number>();
  for (const row of rows) {
    const size = clean(row.values.size);
    const color = clean(row.values.color) || NO_COLOR;
    if (!size) {
      fail(
        row.rowNumber,
        'Falta el talle (si la prenda no tiene, escribí "Único").',
      );
      continue;
    }
    const sizeError =
      textError("Talle", size, { min: 1, max: 30 }) ??
      textError("Color", color, { min: 1, max: 60 });
    if (sizeError) {
      fail(row.rowNumber, sizeError);
      continue;
    }
    const comboKey = `${key(size)}|${key(color)}`;
    const previous = seen.get(comboKey);
    if (previous !== undefined) {
      fail(
        row.rowNumber,
        `Talle y color repetidos (ya están en la fila ${previous}).`,
      );
      continue;
    }
    seen.set(comboKey, row.rowNumber);

    const existingVariant =
      existing?.variants.find(
        (variant) =>
          key(variant.size) === key(size) && key(variant.color) === key(color),
      ) ?? null;
    const rawStock = clean(row.values.stock);
    let stock: number | null | undefined = null;
    if (showStock) {
      if (rawStock) {
        const parsed = parseStock(rawStock);
        if (parsed === null) {
          fail(
            row.rowNumber,
            `Stock inválido: "${rawStock}". Tiene que ser un número entero, 0 o más.`,
          );
          continue;
        }
        stock = parsed;
      } else if (existingVariant?.stock != null && existing?.showStock) {
        stock = undefined;
      } else {
        fail(
          row.rowNumber,
          "Falta el stock. Si alguna fila del producto lleva stock, todas lo necesitan (puede ser 0).",
        );
        continue;
      }
    }
    variants.push({
      rowNumber: row.rowNumber,
      size,
      color,
      stock,
      existingId: existingVariant?.id ?? null,
    });
  }

  if (showStock && existing) {
    const missing = existing.variants.filter(
      (variant) =>
        variant.stock === null &&
        !seen.has(`${key(variant.size)}|${key(variant.color)}`),
    );
    if (missing.length) {
      const list = missing
        .map((variant) =>
          variant.color === NO_COLOR
            ? variant.size
            : `${variant.size} ${variant.color}`,
        )
        .join(", ");
      fail(
        rows[0]!.rowNumber,
        `Para pasar a stock limitado incluí también las variantes ${list} con su stock.`,
      );
    }
  }

  if (issues.length) return { errors: issues };
  return {
    product: {
      code,
      action: existing ? "update" : "create",
      existingId: existing?.id ?? null,
      rowNumbers: rows.map((row) => row.rowNumber),
      fields,
      variants,
    },
  };
}
