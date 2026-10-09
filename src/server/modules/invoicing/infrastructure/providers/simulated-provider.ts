import { createHash } from "node:crypto";

import type {
  InvoicingProvider,
  VoucherRequest,
  VoucherResult,
} from "../../application/ports/invoicing-provider";

/**
 * Proveedor de prueba: "emite" comprobantes sin validez fiscal para probar el
 * circuito completo (pedido, reintentos, notas de crédito, panel y correo)
 * antes de tener las credenciales de Facturante.
 */
export function createSimulatedInvoicingProvider(): InvoicingProvider {
  const issued = new Map<string, VoucherResult>();
  return {
    name: "simulated",
    async createVoucher(request: VoucherRequest) {
      const digest = createHash("sha256")
        .update(request.idempotencyKey)
        .digest("hex");
      const result: VoucherResult = {
        state: "ISSUED",
        providerVoucherId: `SIM-${digest.slice(0, 12)}`,
        pointOfSale: request.pointOfSale ?? 9999,
        // Número estable por comprobante para que reintentar no lo cambie.
        number: Number.parseInt(digest.slice(0, 7), 16) % 99_999_999,
        cae: `SIM${digest.slice(0, 11).toUpperCase()}`,
        caeExpiresAt: new Date(request.issueDate.getTime() + 10 * 86_400_000),
        pdfUrl: null,
      };
      issued.set(result.providerVoucherId, result);
      return result;
    },
    async getVoucher(providerVoucherId: string) {
      return (
        issued.get(providerVoucherId) ?? {
          state: "REJECTED",
          providerVoucherId,
          message: "Comprobante simulado inexistente.",
        }
      );
    },
  };
}
