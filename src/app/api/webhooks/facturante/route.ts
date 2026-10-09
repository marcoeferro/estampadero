import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { env } from "elestampadero/env";
import { invoicingService } from "elestampadero/server/modules/invoicing";

function sameSecret(received: string, expected: string) {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Aviso de Facturante cuando ARCA autoriza (o rechaza) un comprobante. La URL
 * se configura en Facturante con el secreto como parámetro `token`. El aviso
 * solo dispara una consulta: el estado real se lee de la API, nunca del
 * cuerpo recibido.
 */
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (
    !env.FACTURANTE_WEBHOOK_SECRET ||
    !sameSecret(token, env.FACTURANTE_WEBHOOK_SECRET)
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const text = await request.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    payload = Object.fromEntries(new URLSearchParams(text));
  }
  const providerVoucherId = [
    payload.IdComprobante,
    payload.idComprobante,
    payload.id,
    request.nextUrl.searchParams.get("idComprobante"),
  ].find((value) => typeof value === "string" || typeof value === "number");

  if (providerVoucherId === undefined || providerVoucherId === null) {
    return NextResponse.json({ received: true, matched: false });
  }
  const voucher = await invoicingService.handleProviderNotification(
    String(providerVoucherId),
  );
  return NextResponse.json({ received: true, matched: voucher !== null });
}
