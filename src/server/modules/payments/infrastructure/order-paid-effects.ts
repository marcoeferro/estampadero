import "server-only";

import { after } from "next/server";

import { generateCommissionEntriesForOrderUseCase } from "elestampadero/server/modules/commissions";
import { assignOrderToOpenBatchUseCase } from "elestampadero/server/modules/production";
import { invoicingService } from "elestampadero/server/modules/invoicing";
import type { OrderDetailDto } from "elestampadero/server/modules/orders";

import { sendOrderReceiptEmail } from "./order-receipt-email";






export async function runOrderPaidEffects(
  order: OrderDetailDto,
): Promise<void> {
  await Promise.all([
    generateCommissionEntriesForOrderUseCase(order),
    assignOrderToOpenBatchUseCase(order.id),
  ]);



  after(async () => {
    try {
      await sendOrderReceiptEmail(order);
    } catch (error) {
      console.error(`[receipt email] Failed for order ${order.id}`, error);
    }
    // La factura se emite fuera de la respuesta del pago: si Facturante o
    // ARCA no responden, el pedido sigue y el comprobante queda pendiente.
    try {
      await invoicingService.requestInvoice(order.id);
    } catch (error) {
      console.error(`[invoicing] Failed for order ${order.id}`, error);
    }
  });
}
