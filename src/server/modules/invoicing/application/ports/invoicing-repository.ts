import type {
  OrderForInvoicing,
  TaxCondition,
  VoucherKind,
} from "../../domain/voucher-rules";

export type VoucherStatus =
  "PENDING" | "PROCESSING" | "AWAITING_AUTHORIZATION" | "ISSUED" | "FAILED";

export interface VoucherRecord {
  id: string;
  orderId: string;
  kind: VoucherKind;
  voucherType: string;
  idempotencyKey: string;
  status: VoucherStatus;
  amountInCents: number;
  netAmountInCents: number;
  vatAmountInCents: number;
  buyerDocType: string;
  buyerDocNumber: string;
  buyerName: string;
  buyerTaxCondition: TaxCondition;
  provider: string;
  providerVoucherId: string | null;
  pointOfSale: number | null;
  number: number | null;
  cae: string | null;
  caeExpiresAt: Date | null;
  pdfUrl: string | null;
  issuedAt: Date | null;
  emailSentAt: Date | null;
  attempts: number;
  nextAttemptAt: Date;
  errorMessage: string | null;
  relatedVoucherId: string | null;
  createdAt: Date;
}

export type NewVoucher = Pick<
  VoucherRecord,
  | "orderId"
  | "kind"
  | "voucherType"
  | "idempotencyKey"
  | "amountInCents"
  | "netAmountInCents"
  | "vatAmountInCents"
  | "buyerDocType"
  | "buyerDocNumber"
  | "buyerName"
  | "buyerTaxCondition"
  | "provider"
  | "relatedVoucherId"
>;

export type VoucherUpdate = Partial<
  Pick<
    VoucherRecord,
    | "status"
    | "providerVoucherId"
    | "pointOfSale"
    | "number"
    | "cae"
    | "caeExpiresAt"
    | "pdfUrl"
    | "issuedAt"
    | "emailSentAt"
    | "attempts"
    | "nextAttemptAt"
    | "errorMessage"
  >
>;

export interface InvoicingRepository {
  getOrder(
    orderId: string,
  ): Promise<(OrderForInvoicing & { isPaid: boolean }) | null>;
  listVouchersForOrder(orderId: string): Promise<VoucherRecord[]>;
  findVoucher(id: string): Promise<VoucherRecord | null>;
  findByProviderVoucherId(
    providerVoucherId: string,
  ): Promise<VoucherRecord | null>;
  /** Crea el comprobante; si la clave ya existe devuelve el existente. */
  createVoucherOnce(voucher: NewVoucher): Promise<VoucherRecord>;
  /**
   * Toma el comprobante para procesarlo (PENDING vencido → PROCESSING).
   * Devuelve null si otro proceso ya lo tomó.
   */
  claimVoucher(id: string, now: Date): Promise<VoucherRecord | null>;
  updateVoucher(id: string, data: VoucherUpdate): Promise<VoucherRecord>;
  listDuePendingIds(now: Date, limit: number): Promise<string[]>;
  listAwaitingAuthorization(limit: number): Promise<VoucherRecord[]>;
  /** Vuelve a PENDING los que quedaron en PROCESSING por un corte. */
  releaseStuck(olderThan: Date): Promise<number>;
  /** Pedidos con reintegros y factura emitida, candidatos a nota de crédito. */
  listOrdersWithRefunds(limit: number): Promise<string[]>;
}
