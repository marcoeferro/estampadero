import ExcelJS from "exceljs";

import {
  columnForHeader,
  IMPORT_COLUMNS,
  type ImportColumnKey,
} from "../../application/bulk-import/columns";
import type { ImportRow } from "../../application/bulk-import/plan-import";

export class WorkbookFormatError extends Error {}

const PRODUCTS_SHEET = "Productos";
const BRAND = "FF5C258F";

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    // Evita "15000.000000001" por redondeos de Excel.
    return String(Math.round(value * 100) / 100);
  }
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if ("richText" in value)
    return value.richText.map((part) => part.text).join("");
  if ("text" in value && typeof value.text === "string") return value.text;
  if ("result" in value) return cellText(value.result);
  if ("error" in value) return "";
  return "";
}

/** Lee la hoja de productos y devuelve una fila por variante. */
export async function readImportWorkbook(
  bytes: Uint8Array,
): Promise<ImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    );
  } catch {
    throw new WorkbookFormatError(
      "No se pudo leer el archivo. Subí una planilla de Excel (.xlsx).",
    );
  }
  const sheet = workbook.getWorksheet(PRODUCTS_SHEET) ?? workbook.worksheets[0];
  if (!sheet) {
    throw new WorkbookFormatError("La planilla no tiene hojas.");
  }

  const columnByIndex = new Map<number, ImportColumnKey>();
  sheet.getRow(1).eachCell((cell, columnNumber) => {
    const column = columnForHeader(cellText(cell.value));
    if (column && ![...columnByIndex.values()].includes(column)) {
      columnByIndex.set(columnNumber, column);
    }
  });
  const found = new Set(columnByIndex.values());
  const missing = IMPORT_COLUMNS.filter(
    (column) => column.required && !found.has(column.key),
  );
  if (missing.length) {
    throw new WorkbookFormatError(
      `Faltan columnas en la planilla: ${missing.map((column) => column.header).join(", ")}. Descargá la planilla modelo.`,
    );
  }

  const rows: ImportRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values: ImportRow["values"] = {};
    for (const [columnNumber, column] of columnByIndex) {
      values[column] = cellText(row.getCell(columnNumber).value).trim();
    }
    rows.push({ rowNumber, values });
  });
  return rows;
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
  row.alignment = { vertical: "middle" };
  row.height = 22;
}

/** Planilla modelo con las columnas, filas de ejemplo e instrucciones. */
export async function buildImportTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "El Estampadero";

  const sheet = workbook.addWorksheet(PRODUCTS_SHEET, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = IMPORT_COLUMNS.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.key === "description" ? 34 : column.key === "name" ? 26 : 15,
  }));
  styleHeader(sheet.getRow(1));
  IMPORT_COLUMNS.forEach((column, index) => {
    sheet.getRow(1).getCell(index + 1).note = column.help;
  });
  // Un producto de ejemplo con dos talles y dos colores.
  const example = Object.fromEntries(
    IMPORT_COLUMNS.map((column) => [column.key, column.example]),
  );
  for (const [size, color] of [
    ["M", "Negro"],
    ["L", "Negro"],
    ["M", "Blanco"],
    ["L", "Blanco"],
  ]) {
    sheet.addRow({ ...example, size, color });
  }
  for (let rowNumber = 2; rowNumber <= 200; rowNumber += 1) {
    sheet.getCell(
      rowNumber,
      IMPORT_COLUMNS.findIndex((c) => c.key === "status") + 1,
    ).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"Publicado,No publicado"'],
    };
  }

  const help = workbook.addWorksheet("Instrucciones");
  help.columns = [
    { header: "Columna", key: "header", width: 18 },
    { header: "Cómo completarla", key: "help", width: 110 },
  ];
  styleHeader(help.getRow(1));
  for (const column of IMPORT_COLUMNS) {
    help.addRow({ header: column.header, help: column.help });
  }
  help.addRow({});
  help.addRow({
    header: "Reglas",
    help: "Una fila por cada talle y color. Las filas con el mismo código forman un producto. Si el código ya existe, el producto se actualiza y las columnas vacías no se modifican. Las imágenes se agregan después desde el panel. Máximo 1.000 filas por archivo.",
  });
  help.getColumn("help").alignment = { wrapText: true, vertical: "top" };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export interface ImportReportRow {
  rowNumber: number;
  code: string | null;
  result: "Creado" | "Actualizado" | "Error";
  message: string;
}

/** Informe descargable con el resultado de cada fila. */
export async function buildImportReport(
  rows: ImportReportRow[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Resultado", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "Fila", key: "rowNumber", width: 8 },
    { header: "Código", key: "code", width: 18 },
    { header: "Resultado", key: "result", width: 14 },
    { header: "Detalle", key: "message", width: 90 },
  ];
  styleHeader(sheet.getRow(1));
  for (const row of rows) {
    const added = sheet.addRow({
      ...row,
      rowNumber: row.rowNumber || "—",
      code: row.code ?? "",
    });
    if (row.result === "Error") {
      added.getCell("result").font = {
        bold: true,
        color: { argb: "FFA32F27" },
      };
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
