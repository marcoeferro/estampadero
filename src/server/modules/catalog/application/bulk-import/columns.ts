/**
 * Columnas de la planilla de carga masiva. Una fila por variante: las filas
 * con el mismo código forman un producto.
 */
export const IMPORT_COLUMNS = [
  {
    key: "code",
    header: "Código",
    required: true,
    help: "Obligatorio. Identifica el producto: si ya existe se actualiza, si no se crea. Repetilo en cada fila del mismo producto.",
    example: "REM-100",
  },
  {
    key: "name",
    header: "Nombre",
    required: true,
    help: "Obligatorio para productos nuevos. Alcanza con completarlo en la primera fila del producto.",
    example: "Remera entrenamiento",
  },
  {
    key: "description",
    header: "Descripción",
    required: false,
    help: "Opcional.",
    example: "Tela deportiva liviana.",
  },
  {
    key: "price",
    header: "Precio",
    required: true,
    help: "Obligatorio para productos nuevos. En pesos, por ejemplo 15000 o 15.000,50.",
    example: "15000",
  },
  {
    key: "compareAtPrice",
    header: "Precio anterior",
    required: false,
    help: "Opcional. Se muestra tachado; tiene que ser mayor al precio.",
    example: "",
  },
  {
    key: "category",
    header: "Categoría",
    required: false,
    help: "Opcional. Nombre de una categoría existente.",
    example: "",
  },
  {
    key: "line",
    header: "Línea",
    required: false,
    help: "Opcional. Club, Urbana, Training, Trabajo, Escolar o el nombre de una línea creada en el panel.",
    example: "Training",
  },
  {
    key: "club",
    header: "Club",
    required: false,
    help: "Opcional. Nombre del club o socio con convenio activo.",
    example: "",
  },
  {
    key: "status",
    header: "Estado",
    required: false,
    help: "Publicado o No publicado. Vacío: los productos nuevos quedan No publicados y los existentes no cambian.",
    example: "No publicado",
  },
  {
    key: "size",
    header: "Talle",
    required: true,
    help: "Obligatorio. Si la prenda no tiene talles, escribí Único.",
    example: "M",
  },
  {
    key: "color",
    header: "Color",
    required: false,
    help: "Opcional. Vacío si el producto no se ofrece en colores.",
    example: "Negro",
  },
  {
    key: "stock",
    header: "Stock",
    required: false,
    help: "Vacío en todas las filas: el producto se vende por encargo. Si se completa en alguna fila, el producto pasa a stock limitado y todas sus filas necesitan una cantidad (puede ser 0).",
    example: "10",
  },
] as const;

export type ImportColumnKey = (typeof IMPORT_COLUMNS)[number]["key"];

export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

const HEADER_ALIASES: Record<string, ImportColumnKey> = {
  codigo: "code",
  code: "code",
  nombre: "name",
  descripcion: "description",
  precio: "price",
  precio_anterior: "compareAtPrice",
  precio_tachado: "compareAtPrice",
  categoria: "category",
  linea: "line",
  club: "club",
  socio: "club",
  estado: "status",
  visibilidad: "status",
  talle: "size",
  color: "color",
  stock: "stock",
};

export function columnForHeader(header: string): ImportColumnKey | null {
  return HEADER_ALIASES[normalizeHeader(header)] ?? null;
}
