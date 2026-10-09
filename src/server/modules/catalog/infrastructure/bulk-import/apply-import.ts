import "server-only";

import { db } from "elestampadero/server/db";

import type {
  ImportContext,
  ImportPlan,
  PlannedProduct,
} from "../../application/bulk-import/plan-import";
import { clubCanSellWhere } from "../persistence/sellable-products";
import type { ImportReportRow } from "./workbook";

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

function variantSku(code: string, color: string, size: string) {
  return (
    slugify(`${code}-${color}-${size}`).toUpperCase() ||
    slugify(code).toUpperCase()
  );
}

/** Datos de referencia que necesita la validación de la planilla. */
export async function loadImportContext(
  codes: string[],
): Promise<ImportContext> {
  const [categories, lines, clubs, sellableClubs, existingProducts] =
    await Promise.all([
      db.category.findMany({ select: { id: true, name: true, slug: true } }),
      db.catalogLine.findMany({
        where: { isActive: true },
        select: { id: true, name: true, slug: true },
      }),
      db.club.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          slug: true,
          agreements: {
            where: { status: "ACTIVE" },
            select: { id: true },
            take: 1,
          },
        },
      }),
      db.club.findMany({ where: clubCanSellWhere, select: { id: true } }),
      codes.length
        ? db.product.findMany({
            where: {
              OR: codes.map((code) => ({
                code: { equals: code, mode: "insensitive" as const },
              })),
            },
            select: {
              id: true,
              code: true,
              clubId: true,
              showStock: true,
              variants: {
                select: { id: true, size: true, color: true, stock: true },
              },
            },
          })
        : Promise.resolve([]),
    ]);
  const sellable = new Set(sellableClubs.map((club) => club.id));
  return {
    categories,
    lines,
    clubs: clubs.map((club) => ({
      id: club.id,
      name: club.name,
      slug: club.slug,
      hasActiveAgreement: club.agreements.length > 0,
      canSell: sellable.has(club.id),
    })),
    existingProducts,
  };
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

async function applyProduct(product: PlannedProduct) {
  const { fields } = product;
  await db.$transaction(async (tx) => {
    if (product.action === "create") {
      const name = fields.name!;
      await tx.product.create({
        data: {
          code: product.code,
          name,
          slug: `${slugify(name)}-${slugify(product.code)}`,
          description: fields.description ?? null,
          priceInCents: fields.priceInCents!,
          compareAtCents: fields.compareAtCents ?? null,
          categoryId: fields.categoryId ?? null,
          line: fields.line ?? null,
          lineId: fields.lineId ?? null,
          clubId: fields.clubId ?? null,
          status: fields.status ?? "DRAFT",
          showStock: fields.showStock,
          variants: {
            create: product.variants.map((variant) => ({
              size: variant.size,
              color: variant.color,
              stock: variant.stock ?? null,
              sku: variantSku(product.code, variant.color, variant.size),
            })),
          },
        },
      });
      return;
    }

    const productId = product.existingId!;
    await tx.product.update({
      where: { id: productId },
      data: {
        name: fields.name,
        description: fields.description,
        priceInCents: fields.priceInCents,
        compareAtCents: fields.compareAtCents,
        categoryId: fields.categoryId,
        line: fields.line,
        lineId: fields.lineId,
        clubId: fields.clubId,
        status: fields.status,
        showStock: fields.showStock,
      },
    });
    // Por encargo no se controla inventario.
    if (!fields.showStock) {
      await tx.productVariant.updateMany({
        where: { productId },
        data: { stock: null },
      });
    }
    for (const variant of product.variants) {
      if (variant.existingId) {
        if (variant.stock !== undefined) {
          await tx.productVariant.update({
            where: { id: variant.existingId },
            data: { stock: variant.stock },
          });
        }
      } else {
        await tx.productVariant.create({
          data: {
            productId,
            size: variant.size,
            color: variant.color,
            stock: variant.stock ?? null,
            sku: variantSku(product.code, variant.color, variant.size),
          },
        });
      }
    }
  });
}

/**
 * Aplica el plan producto por producto: si uno falla, los demás se cargan
 * igual. Devuelve el resultado de cada fila de la planilla.
 */
export async function applyImportPlan(
  plan: ImportPlan,
): Promise<ImportReportRow[]> {
  const report: ImportReportRow[] = plan.errors.map((issue) => ({
    rowNumber: issue.rowNumber,
    code: issue.code,
    result: "Error",
    message: issue.message,
  }));

  for (const product of plan.products) {
    let message: string | null = null;
    try {
      await applyProduct(product);
    } catch (error) {
      message = isUniqueConstraintError(error)
        ? "El código del producto o de una variante ya lo usa otro producto."
        : "No se pudo guardar el producto. Probá de nuevo.";
      if (!isUniqueConstraintError(error)) {
        console.error("[bulk-import] product failed", product.code, error);
      }
    }
    for (const rowNumber of product.rowNumbers) {
      report.push(
        message
          ? { rowNumber, code: product.code, result: "Error", message }
          : {
              rowNumber,
              code: product.code,
              result: product.action === "create" ? "Creado" : "Actualizado",
              message:
                product.action === "create"
                  ? "Producto creado."
                  : "Producto actualizado.",
            },
      );
    }
  }
  return report.sort((a, b) => a.rowNumber - b.rowNumber);
}
