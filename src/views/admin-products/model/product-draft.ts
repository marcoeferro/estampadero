/**
 * Lógica pura del formulario de productos: armado de variantes como una grilla
 * de talles × colores, validación campo por campo y conversión al payload del
 * servidor. No depende de React para poder probarse por separado.
 */

export type ProductLine =
  "CLUB" | "URBANA" | "TRAINING" | "TRABAJO" | "ESCOLAR";
export type ProductStatus = "DRAFT" | "PUBLISHED" | "OUT_OF_STOCK";

/** Color que se guarda cuando el producto no se ofrece en colores. */
export const NO_COLOR = "Sin definir";
/** Talle sugerido para prendas que no tienen talles. */
export const SINGLE_SIZE = "Único";

export const SIZE_PRESETS: { label: string; sizes: string[] }[] = [
  { label: "Talle único", sizes: [SINGLE_SIZE] },
  { label: "S a XXL", sizes: ["S", "M", "L", "XL", "XXL"] },
  { label: "XS a XL", sizes: ["XS", "S", "M", "L", "XL"] },
  {
    label: "Infantiles 4 a 16",
    sizes: ["4", "6", "8", "10", "12", "14", "16"],
  },
];

export type ImageDraft = {
  id?: string;
  url: string;
  alt: string;
  color: string;
};
export type VariantDraft = {
  id?: string;
  size: string;
  color: string;
  stock: string;
  sku: string;
};

export type ProductDraft = {
  id: string | null;
  name: string;
  code: string;
  description: string;
  price: string;
  compareAtPrice: string;
  line: ProductLine | "";
  lineId: string;
  status: ProductStatus;
  clubId: string;
  allowsCustomPrint: boolean;
  isFeatured: boolean;
  /** true: stock limitado; false: por encargo. */
  showStock: boolean;
  images: ImageDraft[];
  /** Talles del producto, en el orden en que se muestran. */
  sizes: string[];
  /** Colores del producto. Vacío significa "sin colores". */
  colors: string[];
  /** Combinaciones talle × color que se venden. */
  variants: VariantDraft[];
};

export type ProductFieldError =
  | "name"
  | "code"
  | "price"
  | "compareAtPrice"
  | "images"
  | "sizes"
  | "colors"
  | "variants";

/** Clave de error de la celda de stock de una combinación. */
export function stockErrorKey(size: string, color: string) {
  return `stock:${normalize(size)}|${normalize(color)}`;
}

export type ProductDraftErrors = Partial<Record<ProductFieldError, string>> &
  Record<string, string | undefined>;

export function normalize(value: string) {
  return value.trim().toLocaleLowerCase("es");
}

function sameValue(a: string, b: string) {
  return normalize(a) === normalize(b);
}

function uniqueValues(values: string[]) {
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed && !result.some((existing) => sameValue(existing, trimmed))) {
      result.push(trimmed);
    }
  }
  return result;
}

/** Colores efectivos de la grilla: sin colores equivale a una sola columna. */
export function effectiveColors(draft: Pick<ProductDraft, "colors">) {
  return draft.colors.length ? draft.colors : [NO_COLOR];
}

export function findVariant(
  draft: Pick<ProductDraft, "variants">,
  size: string,
  color: string,
) {
  return draft.variants.find(
    (variant) =>
      sameValue(variant.size, size) && sameValue(variant.color, color),
  );
}

export function emptyProductDraft(clubId = ""): ProductDraft {
  return {
    id: null,
    name: "",
    code: "",
    description: "",
    price: "",
    compareAtPrice: "",
    line: clubId ? "CLUB" : "",
    lineId: "",
    status: clubId ? "PUBLISHED" : "DRAFT",
    clubId,
    allowsCustomPrint: false,
    isFeatured: false,
    showStock: false,
    images: [],
    sizes: [],
    colors: [],
    variants: [],
  };
}

/** Deriva talles y colores a partir de las variantes guardadas. */
export function axesFromVariants(
  variants: Pick<VariantDraft, "size" | "color">[],
) {
  const sizes = uniqueValues(variants.map((variant) => variant.size));
  const colors = uniqueValues(variants.map((variant) => variant.color));
  // "Sin definir" solo es una columna propia si convive con colores reales.
  if (colors.length === 1 && sameValue(colors[0]!, NO_COLOR)) {
    return { sizes, colors: [] };
  }
  return { sizes, colors };
}

export function addSizes(draft: ProductDraft, sizes: string[]): ProductDraft {
  const newSizes = uniqueValues(sizes).filter(
    (size) => !draft.sizes.some((existing) => sameValue(existing, size)),
  );
  if (newSizes.length === 0) return draft;
  const colors = effectiveColors(draft);
  return {
    ...draft,
    sizes: [...draft.sizes, ...newSizes],
    variants: [
      ...draft.variants,
      ...newSizes.flatMap((size) =>
        colors.map((color) => ({ size, color, stock: "", sku: "" })),
      ),
    ],
  };
}

export function removeSize(draft: ProductDraft, size: string): ProductDraft {
  return {
    ...draft,
    sizes: draft.sizes.filter((existing) => !sameValue(existing, size)),
    variants: draft.variants.filter(
      (variant) => !sameValue(variant.size, size),
    ),
  };
}

export function addColor(draft: ProductDraft, rawColor: string): ProductDraft {
  const color = rawColor.trim();
  if (
    !color ||
    sameValue(color, NO_COLOR) ||
    draft.colors.some((existing) => sameValue(existing, color))
  ) {
    return draft;
  }
  // El primer color reemplaza a la columna "sin color" y conserva el stock y
  // los códigos ya cargados.
  if (draft.colors.length === 0) {
    return {
      ...draft,
      colors: [color],
      variants: draft.variants.map((variant) =>
        sameValue(variant.color, NO_COLOR) ? { ...variant, color } : variant,
      ),
    };
  }
  return {
    ...draft,
    colors: [...draft.colors, color],
    variants: [
      ...draft.variants,
      ...draft.sizes.map((size) => ({ size, color, stock: "", sku: "" })),
    ],
  };
}

export function removeColor(draft: ProductDraft, color: string): ProductDraft {
  const remaining = draft.colors.filter(
    (existing) => !sameValue(existing, color),
  );
  // Al quitar el último color el producto vuelve a ser "sin color" y conserva
  // sus talles.
  if (remaining.length === 0) {
    return {
      ...draft,
      colors: [],
      variants: draft.variants
        .filter((variant) => sameValue(variant.color, color))
        .map((variant) => ({ ...variant, color: NO_COLOR })),
    };
  }
  return {
    ...draft,
    colors: remaining,
    variants: draft.variants.filter(
      (variant) => !sameValue(variant.color, color),
    ),
  };
}

/** Activa o desactiva la venta de una combinación talle × color. */
export function toggleCombination(
  draft: ProductDraft,
  size: string,
  color: string,
): ProductDraft {
  if (findVariant(draft, size, color)) {
    return {
      ...draft,
      variants: draft.variants.filter(
        (variant) =>
          !(sameValue(variant.size, size) && sameValue(variant.color, color)),
      ),
    };
  }
  return {
    ...draft,
    variants: [...draft.variants, { size, color, stock: "", sku: "" }],
  };
}

export function updateVariant(
  draft: ProductDraft,
  size: string,
  color: string,
  changes: Partial<Pick<VariantDraft, "stock" | "sku">>,
): ProductDraft {
  return {
    ...draft,
    variants: draft.variants.map((variant) =>
      sameValue(variant.size, size) && sameValue(variant.color, color)
        ? { ...variant, ...changes }
        : variant,
    ),
  };
}

/** Carga el mismo stock en todas las combinaciones activas. */
export function fillStock(draft: ProductDraft, stock: string): ProductDraft {
  return {
    ...draft,
    variants: draft.variants.map((variant) => ({ ...variant, stock })),
  };
}

export function setSaleMode(
  draft: ProductDraft,
  showStock: boolean,
): ProductDraft {
  return { ...draft, showStock };
}

/** Variantes en el orden de la grilla (talles, luego colores). */
export function orderedVariants(draft: ProductDraft) {
  const colors = effectiveColors(draft);
  return draft.sizes.flatMap((size) =>
    colors.flatMap((color) => {
      const variant = findVariant(draft, size, color);
      return variant ? [variant] : [];
    }),
  );
}

export function totalStock(draft: ProductDraft) {
  if (!draft.showStock) return null;
  return draft.variants.reduce((total, variant) => {
    const value = Number(variant.stock);
    return total + (variant.stock.trim() && Number.isFinite(value) ? value : 0);
  }, 0);
}

function isMoney(value: string) {
  const parsed = Number(value);
  return value.trim() !== "" && Number.isFinite(parsed) && parsed >= 0;
}

function isStock(value: string) {
  const parsed = Number(value);
  return value.trim() !== "" && Number.isInteger(parsed) && parsed >= 0;
}

/**
 * Valida el borrador y devuelve un mensaje por campo. Un objeto vacío
 * significa que el producto se puede guardar.
 */
export function validateProductDraft(draft: ProductDraft): ProductDraftErrors {
  const errors: ProductDraftErrors = {};
  if (draft.name.trim().length < 2) {
    errors.name = "Ingresá un nombre de al menos 2 caracteres.";
  }
  if (draft.code.trim().length < 2) {
    errors.code = "Ingresá un código de al menos 2 caracteres.";
  }
  if (!isMoney(draft.price)) {
    errors.price = "Ingresá un precio válido.";
  }
  if (draft.compareAtPrice.trim()) {
    if (!isMoney(draft.compareAtPrice)) {
      errors.compareAtPrice = "Ingresá un precio anterior válido.";
    } else if (
      isMoney(draft.price) &&
      Number(draft.compareAtPrice) <= Number(draft.price)
    ) {
      errors.compareAtPrice =
        "El precio anterior tiene que ser mayor al precio actual.";
    }
  }
  if (draft.images.some((image) => !image.url.trim())) {
    errors.images =
      "Completá o quitá las imágenes que no tengan archivo o URL.";
  }
  const isPublishing = draft.status === "PUBLISHED";
  if (draft.sizes.length === 0 && isPublishing) {
    errors.sizes =
      'Agregá al menos un talle. Si la prenda no tiene talles, usá "Talle único".';
  } else if (draft.variants.length === 0 && isPublishing) {
    errors.variants =
      "Marcá al menos una combinación de talle y color para vender.";
  }
  if (draft.showStock) {
    let missingStock = false;
    for (const variant of draft.variants) {
      if (!isStock(variant.stock)) {
        missingStock = true;
        errors[stockErrorKey(variant.size, variant.color)] =
          variant.stock.trim() ? "Número entero, 0 o más." : "Cargá el stock.";
      }
    }
    if (missingStock && !errors.variants) {
      errors.variants =
        "Con stock limitado, cada combinación necesita su cantidad (puede ser 0).";
    }
  }
  return errors;
}

/** Pestaña donde está el primer error, para llevar al usuario hasta él. */
export function tabForErrors(
  errors: ProductDraftErrors,
): "information" | "images" | "variants" | null {
  const keys = Object.keys(errors).filter((key) => errors[key]);
  if (
    keys.some((key) =>
      ["name", "code", "price", "compareAtPrice"].includes(key),
    )
  ) {
    return "information";
  }
  if (keys.includes("images")) return "images";
  if (keys.length) return "variants";
  return null;
}

export function toCents(value: string) {
  return Math.round(Number(value) * 100);
}

/** Convierte el borrador al formato que espera el servidor. */
export function toProductPayload(draft: ProductDraft) {
  return {
    name: draft.name.trim(),
    code: draft.code.trim(),
    description: draft.description.trim() || null,
    priceInCents: toCents(draft.price),
    compareAtCents: draft.compareAtPrice.trim()
      ? toCents(draft.compareAtPrice)
      : null,
    line: draft.line || null,
    lineId: draft.lineId || null,
    status: draft.status,
    clubId: draft.clubId || null,
    allowsCustomPrint: draft.allowsCustomPrint,
    isFeatured: draft.isFeatured,
    showStock: draft.showStock,
    images: draft.images.map((image) => ({
      ...(image.id ? { id: image.id } : {}),
      url: image.url,
      alt: image.alt || null,
      color:
        !image.color || sameValue(image.color, NO_COLOR) ? null : image.color,
    })),
    variants: orderedVariants(draft).map((variant) => ({
      ...(variant.id ? { id: variant.id } : {}),
      size: variant.size.trim(),
      color: variant.color.trim() || NO_COLOR,
      stock:
        draft.showStock && variant.stock.trim() ? Number(variant.stock) : null,
      sku: variant.sku.trim() || null,
    })),
  };
}

/**
 * Borrador para "Guardar y crear otro": conserva línea, socio y modalidad de
 * venta, que suelen repetirse al cargar una serie de productos.
 */
export function nextDraftAfterSave(draft: ProductDraft): ProductDraft {
  return {
    ...emptyProductDraft(draft.clubId),
    line: draft.line,
    lineId: draft.lineId,
    status: draft.status,
    showStock: draft.showStock,
    allowsCustomPrint: draft.allowsCustomPrint,
  };
}

/** Mueve un elemento de una lista; se usa para ordenar las imágenes. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length
  ) {
    return items;
  }
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** Compara dos borradores para saber si hay cambios sin guardar. */
export function isSameDraft(a: ProductDraft, b: ProductDraft) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Arma el borrador de edición a partir de un producto guardado. */
export function draftFromProduct(product: {
  id: string;
  name: string;
  code: string;
  description: string | null;
  priceInCents: number;
  compareAtCents: number | null;
  line: ProductLine | null;
  lineId: string | null;
  status: ProductStatus;
  club: { id: string } | null;
  allowsCustomPrint: boolean;
  isFeatured: boolean;
  showStock: boolean;
  images: {
    id: string;
    url: string;
    alt: string | null;
    color: string | null;
  }[];
  variants: {
    id: string;
    size: string;
    color: string;
    stock: number | null;
    sku: string;
  }[];
}): ProductDraft {
  const { sizes, colors } = axesFromVariants(product.variants);
  return {
    id: product.id,
    name: product.name,
    code: product.code,
    description: product.description ?? "",
    price: String(product.priceInCents / 100),
    compareAtPrice:
      product.compareAtCents === null
        ? ""
        : String(product.compareAtCents / 100),
    line: product.line ?? "",
    lineId: product.lineId ?? "",
    status: product.status === "OUT_OF_STOCK" ? "DRAFT" : product.status,
    clubId: product.club?.id ?? "",
    allowsCustomPrint: product.allowsCustomPrint,
    isFeatured: product.isFeatured,
    showStock: product.showStock,
    images: product.images.map((image) => ({
      id: image.id,
      url: image.url,
      alt: image.alt ?? "",
      color: image.color ?? NO_COLOR,
    })),
    sizes,
    colors,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      size: variant.size,
      color: variant.color,
      stock:
        product.showStock && variant.stock !== null
          ? String(variant.stock)
          : "",
      sku: variant.sku,
    })),
  };
}
