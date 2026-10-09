import { NextResponse, type NextRequest } from "next/server";

import { env } from "elestampadero/env";
import { invoicingService } from "elestampadero/server/modules/invoicing";
import { reconcileAllPayments } from "elestampadero/server/modules/payments";
import { expireUnpaidOrdersUseCase } from "elestampadero/server/modules/orders";








export async function GET(request: NextRequest): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!env.CRON_SECRET || authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await reconcileAllPayments();
  const now = Date.now();
  const expiredOrders = await expireUnpaidOrdersUseCase({
    createdBefore: new Date(
      now - env.UNPAID_ORDER_EXPIRATION_HOURS * 60 * 60_000,
    ),

    paymentActivityBefore: new Date(now - 30 * 60_000),
  });

  if (result.anomalies.length > 0) {
    console.error(
      "[payments reconciliation] anomalies found",
      result.anomalies,
    );
  }

  // Respaldo de la facturación: pendientes, autorizaciones diferidas de ARCA
  // y notas de crédito por reintegros.
  const invoicing = await invoicingService.runQueue().catch((error: unknown) => {
    console.error("[invoicing] queue failed", error);
    return null;
  });

  return NextResponse.json({ ...result, expiredOrders, invoicing });
}
