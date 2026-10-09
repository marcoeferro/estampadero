import { NextResponse } from "next/server";

import { db } from "elestampadero/server/db";
import { voucherTypeLabel } from "elestampadero/server/modules/invoicing";

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] ?? character,
  );
}

function money(cents: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(cents / 100);
}

/**
 * Descarga de un comprobante emitido. Con Facturante redirige a su PDF; con
 * el proveedor simulado muestra una versión imprimible sin validez fiscal.
 * Se accede con el identificador del comprobante, igual que la página del
 * pedido se accede con el del pedido.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const voucher = await db.fiscalVoucher.findUnique({
    where: { id },
    include: { order: { select: { orderNumber: true } } },
  });
  if (voucher?.status !== "ISSUED") {
    return NextResponse.json(
      { error: "Comprobante no disponible." },
      { status: 404 },
    );
  }
  if (voucher.pdfUrl?.startsWith("https://")) {
    return NextResponse.redirect(voucher.pdfUrl);
  }

  const number = `${String(voucher.pointOfSale ?? 0).padStart(5, "0")}-${String(
    voucher.number ?? 0,
  ).padStart(8, "0")}`;
  const simulated = voucher.provider === "simulated";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(voucherTypeLabel(voucher.voucherType))} ${number}</title>
<style>body{font-family:Arial,sans-serif;color:#2b2233;max-width:720px;margin:32px auto;padding:0 16px}
h1{color:#5c258f;margin:0}table{width:100%;border-collapse:collapse;margin-top:16px}
td{padding:8px;border-bottom:1px solid #e8e5ed}.warn{background:#fff5f4;color:#a32f27;padding:12px;border-radius:6px;font-weight:bold}
@media print{button{display:none}}</style></head><body>
${simulated ? '<p class="warn">COMPROBANTE DE PRUEBA · SIN VALIDEZ FISCAL</p>' : ""}
<h1>${escapeHtml(voucherTypeLabel(voucher.voucherType))} ${number}</h1>
<p>El Estampadero · Pedido #${String(voucher.order.orderNumber).padStart(6, "0")}</p>
<table>
<tr><td>Fecha</td><td>${voucher.issuedAt?.toLocaleDateString("es-AR") ?? ""}</td></tr>
<tr><td>Cliente</td><td>${escapeHtml(voucher.buyerName)}</td></tr>
<tr><td>${escapeHtml(voucher.buyerDocType)}</td><td>${escapeHtml(voucher.buyerDocNumber)}</td></tr>
${voucher.vatAmountInCents > 0 ? `<tr><td>Neto gravado</td><td>${money(voucher.netAmountInCents)}</td></tr><tr><td>IVA</td><td>${money(voucher.vatAmountInCents)}</td></tr>` : ""}
<tr><td><strong>Total</strong></td><td><strong>${money(voucher.amountInCents)}</strong></td></tr>
<tr><td>CAE</td><td>${escapeHtml(voucher.cae ?? "")}</td></tr>
<tr><td>Vencimiento CAE</td><td>${voucher.caeExpiresAt?.toLocaleDateString("es-AR") ?? ""}</td></tr>
</table>
<p><button onclick="window.print()">Imprimir o guardar como PDF</button></p>
</body></html>`;
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
