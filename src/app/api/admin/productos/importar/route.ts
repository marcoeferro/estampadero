import { NextResponse } from "next/server";

import { auth } from "elestampadero/server/auth";
import { MAX_IMPORT_BYTES } from "elestampadero/server/modules/catalog/application/bulk-import/columns";
import { planImport } from "elestampadero/server/modules/catalog/application/bulk-import/plan-import";
import {
  applyImportPlan,
  loadImportContext,
} from "elestampadero/server/modules/catalog/infrastructure/bulk-import/apply-import";
import {
  buildImportReport,
  readImportWorkbook,
  WorkbookFormatError,
} from "elestampadero/server/modules/catalog/infrastructure/bulk-import/workbook";
import { checkRateLimit } from "elestampadero/server/security/rate-limit";

const ADMIN_ROLES = new Set(["ADMIN", "SUPER_ADMIN"]);
const XLSX_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

function countProducts(
  report: { code: string | null; result: string }[],
  result: "Creado" | "Actualizado",
) {
  return new Set(
    report.filter((row) => row.result === result).map((row) => row.code),
  ).size;
}

/**
 * Carga masiva de productos. `mode=preview` valida y devuelve qué se va a
 * crear, actualizar y qué filas tienen errores, sin guardar nada.
 * `mode=apply` vuelve a validar el mismo archivo y lo carga.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  if (!ADMIN_ROLES.has(session.user.role)) {
    return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_IMPORT_BYTES + 512 * 1024) {
    return NextResponse.json(
      { error: "El archivo no puede superar los 5 MB." },
      { status: 413 },
    );
  }

  const rateLimit = await checkRateLimit(
    `admin:product-import:${session.user.id}`,
    60,
    60 * 60_000,
  );
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Alcanzaste el límite temporal de importaciones." },
      { status: 429 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const mode = formData.get("mode") === "apply" ? "apply" : "preview";
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Seleccioná una planilla para subir." },
      { status: 400 },
    );
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return NextResponse.json(
      { error: "El archivo no puede superar los 5 MB." },
      { status: 413 },
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!XLSX_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return NextResponse.json(
      { error: "El archivo tiene que ser una planilla de Excel (.xlsx)." },
      { status: 400 },
    );
  }

  let rows;
  try {
    rows = await readImportWorkbook(bytes);
  } catch (error) {
    if (error instanceof WorkbookFormatError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const codes = [
    ...new Set(rows.map((row) => row.values.code?.trim()).filter(Boolean)),
  ] as string[];
  const plan = planImport(rows, await loadImportContext(codes));

  if (mode === "preview") {
    return NextResponse.json({
      totalRows: plan.totalRows,
      products: plan.products.map((product) => ({
        code: product.code,
        name: product.fields.name ?? null,
        action: product.action,
        variants: product.variants.length,
        rows: product.rowNumbers.length,
        showStock: product.fields.showStock,
        status: product.fields.status ?? null,
      })),
      errors: plan.errors,
    });
  }

  const report = await applyImportPlan(plan);
  const workbook = await buildImportReport(report);
  return NextResponse.json({
    totalRows: plan.totalRows,
    created: countProducts(report, "Creado"),
    updated: countProducts(report, "Actualizado"),
    errorRows: report.filter((row) => row.result === "Error").length,
    rows: report,
    reportBase64: workbook.toString("base64"),
  });
}
