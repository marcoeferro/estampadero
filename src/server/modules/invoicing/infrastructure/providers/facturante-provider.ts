import {
  TransientInvoicingError,
  type InvoicingProvider,
} from "../../application/ports/invoicing-provider";

export interface FacturanteConfig {
  environment: "testing" | "production";
  user: string;
  password: string;
  companyId: string;
}

/** Servicio SOAP de Facturante (documentación: facturante.com/Developers). */
export const FACTURANTE_ENDPOINTS = {
  testing: "https://testing.facturante.com/api/comprobantes.svc",
  production: "https://www.facturante.com/api/comprobantes.svc",
} as const;

export class FacturanteNotReadyError extends TransientInvoicingError {}

/**
 * Adaptador de Facturante.
 *
 * Cada llamada envía la autenticación (usuario, hash y empresa) que indica la
 * documentación. El armado del mensaje SOAP (nombres de operaciones y campos)
 * se completa con el WSDL del entorno de pruebas, que Facturante entrega junto
 * con las credenciales: hasta entonces los comprobantes quedan pendientes y se
 * emiten solos cuando el adaptador esté terminado.
 */
export function createFacturanteProvider(
  config: FacturanteConfig,
): InvoicingProvider {
  const endpoint = FACTURANTE_ENDPOINTS[config.environment];
  const notReady = () =>
    new FacturanteNotReadyError(
      `Integración con Facturante pendiente de homologar (${endpoint}). El comprobante queda pendiente.`,
    );
  return {
    name: "facturante",
    async createVoucher() {
      throw notReady();
    },
    async getVoucher() {
      throw notReady();
    },
  };
}
