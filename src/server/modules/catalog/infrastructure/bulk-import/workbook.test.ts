import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  buildImportReport,
  buildImportTemplate,
  readImportWorkbook,
  WorkbookFormatError,
} from "./workbook";

async function workbookBytes(
  build: (sheet: ExcelJS.Worksheet) => void,
  sheetName = "Productos",
) {
  const workbook = new ExcelJS.Workbook();
  build(workbook.addWorksheet(sheetName));
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

describe("planilla de carga masiva", () => {
  it("la planilla modelo se puede volver a leer con su producto de ejemplo", async () => {
    const rows = await readImportWorkbook(
      new Uint8Array(await buildImportTemplate()),
    );
    expect(rows).toHaveLength(4);
    expect(rows[0]?.rowNumber).toBe(2);
    expect(rows[0]?.values).toMatchObject({
      code: "REM-100",
      name: "Remera entrenamiento",
      price: "15000",
      size: "M",
      color: "Negro",
      stock: "10",
    });
  });

  it("lee columnas en cualquier orden, números y textos enriquecidos", async () => {
    const bytes = await workbookBytes((sheet) => {
      sheet.addRow(["talle", "PRECIO", "Código", "Nombre", "Otra"]);
      sheet.addRow([
        "M",
        15000.5,
        { richText: [{ text: "REM-" }, { text: "1" }] },
        "Remera",
        "ignorada",
      ]);
      sheet.addRow([]);
      sheet.addRow(["L", 15000.5, "REM-1", null, null]);
    }, "Hoja1");
    const rows = await readImportWorkbook(bytes);
    expect(rows).toEqual([
      {
        rowNumber: 2,
        values: { size: "M", price: "15000.5", code: "REM-1", name: "Remera" },
      },
      {
        rowNumber: 4,
        values: { size: "L", price: "15000.5", code: "REM-1", name: "" },
      },
    ]);
  });

  it("avisa qué columnas obligatorias faltan", async () => {
    const bytes = await workbookBytes((sheet) => {
      sheet.addRow(["Código", "Nombre"]);
    });
    await expect(readImportWorkbook(bytes)).rejects.toThrow(
      /Faltan columnas en la planilla: Precio, Talle/,
    );
  });

  it("rechaza archivos que no son Excel", async () => {
    await expect(
      readImportWorkbook(new TextEncoder().encode("no es un excel")),
    ).rejects.toBeInstanceOf(WorkbookFormatError);
  });

  it("genera el informe con una fila por resultado", async () => {
    const buffer = await buildImportReport([
      {
        rowNumber: 2,
        code: "REM-1",
        result: "Creado",
        message: "Producto creado.",
      },
      {
        rowNumber: 3,
        code: "MAL",
        result: "Error",
        message: "Precio inválido.",
      },
    ]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("Resultado")!;
    expect(sheet.getRow(1).values).toEqual([
      undefined,
      "Fila",
      "Código",
      "Resultado",
      "Detalle",
    ]);
    expect(sheet.getRow(3).values).toEqual([
      undefined,
      3,
      "MAL",
      "Error",
      "Precio inválido.",
    ]);
  });
});
