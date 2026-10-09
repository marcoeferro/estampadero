import "server-only";

import { env } from "elestampadero/env";
import { db } from "elestampadero/server/db";

import type { VoucherRecord } from "../application/ports/invoicing-repository";
import { voucherTypeLabel } from "../domain/voucher-rules";

function voucherNumber(voucher: Pick<VoucherRecord, "pointOfSale" | "number">) {
  return `${String(voucher.pointOfSale ?? 0).padStart(5, "0")}-${String(
    voucher.number ?? 0,
  ).padStart(8, "0")}`;
}

/** Envía al comprador el aviso de factura emitida con el enlace de descarga. */
export async function sendInvoiceEmail(voucher: VoucherRecord): Promise<void> {
  if (!env.RESEND_API_KEY || !env.RECEIPT_EMAIL_FROM) return;
  const order = await db.order.findUnique({
    where: { id: voucher.orderId },
    select: {
      id: true,
      orderNumber: true,
      contactEmail: true,
      contactName: true,
    },
  });
  if (!order) return;
  const orderNumber = String(order.orderNumber).padStart(6, "0");
  const orderUrl = `${env.APP_URL}/pedido/${order.id}`;
  const label = `${voucherTypeLabel(voucher.voucherType)} ${voucherNumber(voucher)}`;
  const html = `
    <div style="font-family:Arial,sans-serif;color:#2b2233;max-width:560px">
      <h2 style="color:#5c258f">Tu factura del pedido #${orderNumber}</h2>
      <p>Ya está disponible la ${label} de tu compra en El Estampadero.</p>
      <p><a href="${orderUrl}" style="display:inline-block;background:#5c258f;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none">Ver pedido y descargar factura</a></p>
      <p style="color:#6b6472;font-size:13px">CAE ${voucher.cae ?? ""}</p>
    </div>`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `invoice-email-${voucher.id}`,
    },
    body: JSON.stringify({
      from: env.RECEIPT_EMAIL_FROM,
      to: [order.contactEmail],
      subject: `Factura del pedido #${orderNumber} · El Estampadero`,
      html,
    }),
  });
  if (!response.ok) {
    throw new Error(`Resend respondió ${response.status}`);
  }
  await db.fiscalVoucher.update({
    where: { id: voucher.id },
    data: { emailSentAt: new Date() },
  });
}
