import type {
  VoucherBuyer,
  VoucherKind,
  VoucherLetter,
  VoucherLine,
} from "../../domain/voucher-rules";

export interface VoucherRequest {
  /** Clave única: el proveedor no debe emitir dos veces el mismo comprobante. */
  idempotencyKey: string;
  kind: VoucherKind;
  letter: VoucherLetter;
  voucherType: string;
  pointOfSale: number | null;
  issueDate: Date;
  orderNumber: number;
  buyer: VoucherBuyer;
  lines: VoucherLine[];
  amountInCents: number;
  netAmountInCents: number;
  vatAmountInCents: number;
  vatRate: number;
  /** Factura que anula una nota de crédito. */
  relatedVoucher: {
    voucherType: string;
    pointOfSale: number | null;
    number: number | null;
    providerVoucherId: string | null;
  } | null;
}

export type VoucherResult =
  | {
      state: "ISSUED";
      providerVoucherId: string;
      pointOfSale: number;
      number: number;
      cae: string;
      caeExpiresAt: Date;
      pdfUrl: string | null;
    }
  /** El proveedor lo recibió y ARCA lo autoriza más tarde. */
  | { state: "QUEUED"; providerVoucherId: string }
  /** Rechazo definitivo: requiere revisión manual. */
  | { state: "REJECTED"; providerVoucherId: string | null; message: string };

/** Error temporal (sin conexión, servicio caído): se reintenta solo. */
export class TransientInvoicingError extends Error {}

export interface InvoicingProvider {
  readonly name: string;
  createVoucher(request: VoucherRequest): Promise<VoucherResult>;
  getVoucher(providerVoucherId: string): Promise<VoucherResult>;
}
