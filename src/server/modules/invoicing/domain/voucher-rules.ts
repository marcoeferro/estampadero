/**
 * Reglas fiscales para decidir qué comprobante se emite y por qué importe.
 * Funciones puras, sin acceso a base de datos ni al proveedor.
 */

export type TaxCondition =
  "CONSUMIDOR_FINAL" | "RESPONSABLE_INSCRIPTO" | "MONOTRIBUTO" | "EXENTO";
export type IssuerTaxCondition = "MONOTRIBUTO" | "RESPONSABLE_INSCRIPTO";
export type VoucherLetter = "A" | "B" | "C";
export type VoucherKind = "INVOICE" | "CREDIT_NOTE";
/** TOTAL: el taller factura todo el pedido. STORE_SHARE: solo su parte. */
export type ClubItemsMode = "TOTAL" | "STORE_SHARE";

export interface InvoicingConfig {
  issuerTaxCondition: IssuerTaxCondition;
  clubItemsMode: ClubItemsMode;
  vatRate: number;
}

export interface OrderForInvoicing {
  id: string;
  orderNumber: number;
  contactName: string;
  customerDocument: string | null;
  customerTaxId: string | null;
  customerLegalName: string | null;
  customerTaxCondition: TaxCondition | null;
  shippingInCents: number;
  totalInCents: number;
  /** Suma de lo reintegrado en todos los pagos del pedido. */
  refundedInCents: number;
  items: {
    productName: string;
    size: string;
    color: string;
    quantity: number;
    lineTotalInCents: number;
    clubId: string | null;
    clubSharePercentage: number | null;
  }[];
}

export interface VoucherBuyer {
  docType: "DNI" | "CUIT" | "SIN_IDENTIFICAR";
  docNumber: string;
  name: string;
  taxCondition: TaxCondition;
}

export interface VoucherLine {
  description: string;
  quantity: number;
  totalInCents: number;
}

export class InvoicingRuleError extends Error {}

/**
 * Letra del comprobante. Un monotributista emite siempre C. Un responsable
 * inscripto emite A a inscriptos y monotributistas, y B al resto.
 */
export function voucherLetter(
  issuer: IssuerTaxCondition,
  buyer: TaxCondition,
): VoucherLetter {
  if (issuer === "MONOTRIBUTO") return "C";
  return buyer === "RESPONSABLE_INSCRIPTO" || buyer === "MONOTRIBUTO"
    ? "A"
    : "B";
}

export function voucherTypeCode(kind: VoucherKind, letter: VoucherLetter) {
  return `${kind === "INVOICE" ? "FACTURA" : "NOTA_CREDITO"}_${letter}`;
}

export function voucherTypeLabel(voucherType: string) {
  const [kind, letter] = voucherType.startsWith("NOTA_CREDITO")
    ? ["Nota de crédito", voucherType.slice(-1)]
    : ["Factura", voucherType.slice(-1)];
  return `${kind} ${letter}`;
}

export function buyerForOrder(order: OrderForInvoicing): VoucherBuyer {
  if (order.customerTaxId) {
    return {
      docType: "CUIT",
      docNumber: order.customerTaxId,
      name: order.customerLegalName ?? order.contactName,
      taxCondition: order.customerTaxCondition ?? "CONSUMIDOR_FINAL",
    };
  }
  const document = order.customerDocument?.trim();
  return {
    docType: document ? "DNI" : "SIN_IDENTIFICAR",
    docNumber: document ?? "0",
    name: order.contactName,
    taxCondition: "CONSUMIDOR_FINAL",
  };
}

/** Separa neto e IVA de un importe final. Las facturas C no discriminan IVA. */
export function splitVat(
  amountInCents: number,
  letter: VoucherLetter,
  vatRate: number,
) {
  if (letter === "C" || vatRate === 0) {
    return { netAmountInCents: amountInCents, vatAmountInCents: 0 };
  }
  const net = Math.round(amountInCents / (1 + vatRate / 100));
  return { netAmountInCents: net, vatAmountInCents: amountInCents - net };
}

/**
 * Líneas que factura el taller. Con STORE_SHARE, de cada producto de club se
 * factura solo la parte que queda para el taller.
 */
export function invoiceLines(
  order: OrderForInvoicing,
  mode: ClubItemsMode,
): VoucherLine[] {
  const lines: VoucherLine[] = [];
  for (const item of order.items) {
    const variant = [item.size, item.color]
      .filter((value) => value && value !== "Sin definir")
      .join(" / ");
    const description = variant
      ? `${item.productName} (${variant})`
      : item.productName;
    if (mode === "STORE_SHARE" && item.clubId) {
      if (item.clubSharePercentage === null) {
        throw new InvoicingRuleError(
          `El ítem "${item.productName}" no tiene guardado el porcentaje del club; emití el comprobante manualmente.`,
        );
      }
      const clubAmount = Math.round(
        (item.lineTotalInCents * item.clubSharePercentage) / 100,
      );
      const storeAmount = item.lineTotalInCents - clubAmount;
      if (storeAmount > 0) {
        lines.push({
          description: `${description} · participación del taller`,
          quantity: item.quantity,
          totalInCents: storeAmount,
        });
      }
      continue;
    }
    lines.push({
      description,
      quantity: item.quantity,
      totalInCents: item.lineTotalInCents,
    });
  }
  if (order.shippingInCents > 0) {
    lines.push({
      description: "Envío",
      quantity: 1,
      totalInCents: order.shippingInCents,
    });
  }
  return lines;
}

export function sumLines(lines: VoucherLine[]) {
  return lines.reduce((total, line) => total + line.totalInCents, 0);
}

/**
 * Importe de nota de crédito pendiente: la parte proporcional de lo
 * reintegrado que corresponde a lo facturado, menos lo ya acreditado.
 */
export function pendingCreditAmount({
  refundedInCents,
  orderTotalInCents,
  invoicedInCents,
  alreadyCreditedInCents,
}: {
  refundedInCents: number;
  orderTotalInCents: number;
  invoicedInCents: number;
  alreadyCreditedInCents: number;
}) {
  if (refundedInCents <= 0 || orderTotalInCents <= 0) return 0;
  const target = Math.min(
    invoicedInCents,
    Math.round((refundedInCents * invoicedInCents) / orderTotalInCents),
  );
  return Math.max(0, target - alreadyCreditedInCents);
}

/** Proporción de cada línea para una nota de crédito parcial. */
export function scaleLines(lines: VoucherLine[], amountInCents: number) {
  const total = sumLines(lines);
  if (total === 0 || amountInCents >= total) return lines;
  let assigned = 0;
  return lines.map((line, index) => {
    const value =
      index === lines.length - 1
        ? amountInCents - assigned
        : Math.round((line.totalInCents * amountInCents) / total);
    assigned += value;
    return { ...line, totalInCents: value };
  });
}

const RETRY_DELAYS_MINUTES = [1, 5, 15, 30, 60, 120, 240, 480, 720, 1440];

/**
 * Espera antes del próximo intento cuando el proveedor o ARCA no responden.
 * Devuelve null cuando se agotaron los intentos automáticos.
 */
export function retryDelayMs(attempts: number) {
  const minutes = RETRY_DELAYS_MINUTES[attempts - 1];
  return minutes === undefined ? null : minutes * 60_000;
}
