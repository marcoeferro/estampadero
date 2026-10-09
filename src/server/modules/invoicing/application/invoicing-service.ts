import {
  buyerForOrder,
  InvoicingRuleError,
  invoiceLines,
  pendingCreditAmount,
  retryDelayMs,
  scaleLines,
  splitVat,
  sumLines,
  voucherLetter,
  voucherTypeCode,
  type InvoicingConfig,
  type VoucherLetter,
} from "../domain/voucher-rules";
import {
  TransientInvoicingError,
  type InvoicingProvider,
  type VoucherResult,
} from "./ports/invoicing-provider";
import type {
  InvoicingRepository,
  VoucherRecord,
} from "./ports/invoicing-repository";

export interface InvoicingServiceDeps {
  repository: InvoicingRepository;
  provider: InvoicingProvider | null;
  config: InvoicingConfig & { pointOfSale: number | null };
  now?: () => Date;
  /** Se llama una vez cuando una factura queda emitida. */
  onInvoiceIssued?: (voucher: VoucherRecord) => Promise<void>;
  log?: (message: string, error?: unknown) => void;
}

const PROCESSING_TIMEOUT_MS = 10 * 60_000;

export function invoiceKey(orderId: string) {
  return `order:${orderId}:invoice`;
}

export function createInvoicingService(deps: InvoicingServiceDeps) {
  const { repository, provider, config } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((message, error) => console.error(message, error));

  function letterOf(voucher: Pick<VoucherRecord, "voucherType">) {
    return voucher.voucherType.slice(-1) as VoucherLetter;
  }

  /**
   * Crea la factura del pedido (una sola vez) y la intenta emitir. Si el
   * proveedor falla, queda pendiente y se reintenta sola.
   */
  async function requestInvoice(orderId: string) {
    if (!provider) return null;
    const order = await repository.getOrder(orderId);
    if (!order?.isPaid) return null;

    const buyer = buyerForOrder(order);
    const letter = voucherLetter(config.issuerTaxCondition, buyer.taxCondition);
    const amount = sumLines(invoiceLines(order, config.clubItemsMode));
    const voucher = await repository.createVoucherOnce({
      orderId,
      kind: "INVOICE",
      voucherType: voucherTypeCode("INVOICE", letter),
      idempotencyKey: invoiceKey(orderId),
      amountInCents: amount,
      ...splitVat(amount, letter, config.vatRate),
      buyerDocType: buyer.docType,
      buyerDocNumber: buyer.docNumber,
      buyerName: buyer.name,
      buyerTaxCondition: buyer.taxCondition,
      provider: provider.name,
      relatedVoucherId: null,
    });
    if (voucher.status === "PENDING") return processVoucher(voucher.id);
    return voucher;
  }

  async function applyResult(voucher: VoucherRecord, result: VoucherResult) {
    if (result.state === "ISSUED") {
      const issued = await repository.updateVoucher(voucher.id, {
        status: "ISSUED",
        providerVoucherId: result.providerVoucherId,
        pointOfSale: result.pointOfSale,
        number: result.number,
        cae: result.cae,
        caeExpiresAt: result.caeExpiresAt,
        pdfUrl: result.pdfUrl,
        issuedAt: now(),
        errorMessage: null,
      });
      if (
        issued.kind === "INVOICE" &&
        !issued.emailSentAt &&
        deps.onInvoiceIssued
      ) {
        try {
          await deps.onInvoiceIssued(issued);
        } catch (error) {
          log(`[invoicing] email failed for voucher ${issued.id}`, error);
        }
      }
      return issued;
    }
    if (result.state === "QUEUED") {
      return repository.updateVoucher(voucher.id, {
        status: "AWAITING_AUTHORIZATION",
        providerVoucherId: result.providerVoucherId,
        errorMessage: null,
      });
    }
    return repository.updateVoucher(voucher.id, {
      status: "FAILED",
      providerVoucherId: result.providerVoucherId ?? voucher.providerVoucherId,
      errorMessage: result.message,
    });
  }

  async function scheduleRetry(voucher: VoucherRecord, error: unknown) {
    const attempts = voucher.attempts + 1;
    const delay = retryDelayMs(attempts);
    const message =
      error instanceof Error
        ? error.message
        : "Error desconocido del proveedor.";
    return repository.updateVoucher(voucher.id, {
      status: delay === null ? "FAILED" : "PENDING",
      attempts,
      nextAttemptAt: new Date(now().getTime() + (delay ?? 0)),
      errorMessage:
        delay === null
          ? `Se agotaron los reintentos automáticos. Último error: ${message}`
          : message,
    });
  }

  async function buildRequest(voucher: VoucherRecord) {
    const order = await repository.getOrder(voucher.orderId);
    if (!order) throw new InvoicingRuleError("El pedido ya no existe.");
    let lines = invoiceLines(order, config.clubItemsMode);
    let related: VoucherRecord | null = null;
    if (voucher.kind === "CREDIT_NOTE") {
      related = voucher.relatedVoucherId
        ? await repository.findVoucher(voucher.relatedVoucherId)
        : null;
      if (!related)
        throw new InvoicingRuleError("Falta la factura a acreditar.");
      lines = scaleLines(lines, voucher.amountInCents);
    }
    return {
      idempotencyKey: voucher.idempotencyKey,
      kind: voucher.kind,
      letter: letterOf(voucher),
      voucherType: voucher.voucherType,
      pointOfSale: config.pointOfSale,
      issueDate: now(),
      orderNumber: order.orderNumber,
      buyer: {
        docType: voucher.buyerDocType as "DNI" | "CUIT" | "SIN_IDENTIFICAR",
        docNumber: voucher.buyerDocNumber,
        name: voucher.buyerName,
        taxCondition: voucher.buyerTaxCondition,
      },
      lines,
      amountInCents: voucher.amountInCents,
      netAmountInCents: voucher.netAmountInCents,
      vatAmountInCents: voucher.vatAmountInCents,
      vatRate: config.vatRate,
      relatedVoucher: related
        ? {
            voucherType: related.voucherType,
            pointOfSale: related.pointOfSale,
            number: related.number,
            providerVoucherId: related.providerVoucherId,
          }
        : null,
    };
  }

  /** Envía un comprobante pendiente al proveedor. */
  async function processVoucher(voucherId: string) {
    if (!provider) return repository.findVoucher(voucherId);
    const voucher = await repository.claimVoucher(voucherId, now());
    if (!voucher) return repository.findVoucher(voucherId);
    try {
      const request = await buildRequest(voucher);
      return await applyResult(voucher, await provider.createVoucher(request));
    } catch (error) {
      if (error instanceof InvoicingRuleError) {
        return repository.updateVoucher(voucher.id, {
          status: "FAILED",
          errorMessage: error.message,
        });
      }
      if (!(error instanceof TransientInvoicingError)) {
        log(`[invoicing] unexpected error for voucher ${voucher.id}`, error);
      }
      return scheduleRetry(voucher, error);
    }
  }

  /** Consulta al proveedor un comprobante que ARCA todavía no autorizó. */
  async function refreshVoucher(voucher: VoucherRecord) {
    if (!provider || !voucher.providerVoucherId) return voucher;
    if (voucher.status !== "AWAITING_AUTHORIZATION") return voucher;
    try {
      const result = await provider.getVoucher(voucher.providerVoucherId);
      if (result.state === "QUEUED") return voucher;
      return await applyResult(voucher, result);
    } catch (error) {
      log(`[invoicing] refresh failed for voucher ${voucher.id}`, error);
      return voucher;
    }
  }

  /** Para la notificación del proveedor: busca el comprobante y lo actualiza. */
  async function handleProviderNotification(providerVoucherId: string) {
    const voucher = await repository.findByProviderVoucherId(providerVoucherId);
    return voucher ? refreshVoucher(voucher) : null;
  }

  /**
   * Emite la nota de crédito por lo reintegrado que todavía no se acreditó.
   * Sirve tanto para devoluciones aprobadas en el panel como para reintegros
   * informados por el medio de pago.
   */
  async function syncCreditNotes(orderId: string) {
    if (!provider) return [];
    const [order, vouchers] = await Promise.all([
      repository.getOrder(orderId),
      repository.listVouchersForOrder(orderId),
    ]);
    const invoice = vouchers.find(
      (voucher) => voucher.kind === "INVOICE" && voucher.status === "ISSUED",
    );
    if (!order || !invoice) return [];
    const credited = vouchers
      .filter(
        (voucher) =>
          voucher.kind === "CREDIT_NOTE" && voucher.status !== "FAILED",
      )
      .reduce((total, voucher) => total + voucher.amountInCents, 0);
    const amount = pendingCreditAmount({
      refundedInCents: order.refundedInCents,
      orderTotalInCents: order.totalInCents,
      invoicedInCents: invoice.amountInCents,
      alreadyCreditedInCents: credited,
    });
    if (amount <= 0) return [];
    const letter = letterOf(invoice);
    const creditNote = await repository.createVoucherOnce({
      orderId,
      kind: "CREDIT_NOTE",
      voucherType: voucherTypeCode("CREDIT_NOTE", letter),
      // La clave incluye el total acreditado: un nuevo reintegro genera otra nota.
      idempotencyKey: `order:${orderId}:credit:${credited + amount}`,
      amountInCents: amount,
      ...splitVat(amount, letter, config.vatRate),
      buyerDocType: invoice.buyerDocType,
      buyerDocNumber: invoice.buyerDocNumber,
      buyerName: invoice.buyerName,
      buyerTaxCondition: invoice.buyerTaxCondition,
      provider: provider.name,
      relatedVoucherId: invoice.id,
    });
    return [await processVoucher(creditNote.id)];
  }

  /** Reintento manual desde el panel. */
  async function retryVoucher(voucherId: string) {
    const voucher = await repository.findVoucher(voucherId);
    if (
      !voucher ||
      (voucher.status !== "FAILED" && voucher.status !== "PENDING")
    ) {
      return voucher;
    }
    await repository.updateVoucher(voucherId, {
      status: "PENDING",
      nextAttemptAt: now(),
      attempts: 0,
      errorMessage: null,
    });
    return processVoucher(voucherId);
  }

  /**
   * Tarea periódica: libera los trabados, emite los pendientes, consulta los
   * que esperan autorización y genera las notas de crédito que falten.
   */
  async function runQueue({ limit = 25 } = {}) {
    if (!provider) return { processed: 0, refreshed: 0, creditNotes: 0 };
    await repository.releaseStuck(
      new Date(now().getTime() - PROCESSING_TIMEOUT_MS),
    );
    const due = await repository.listDuePendingIds(now(), limit);
    for (const id of due) await processVoucher(id);
    const awaiting = await repository.listAwaitingAuthorization(limit);
    for (const voucher of awaiting) await refreshVoucher(voucher);
    let creditNotes = 0;
    for (const orderId of await repository.listOrdersWithRefunds(limit)) {
      creditNotes += (await syncCreditNotes(orderId)).length;
    }
    return { processed: due.length, refreshed: awaiting.length, creditNotes };
  }

  return {
    isEnabled: provider !== null,
    requestInvoice,
    processVoucher,
    refreshVoucher,
    handleProviderNotification,
    syncCreditNotes,
    retryVoucher,
    runQueue,
  };
}

export type InvoicingService = ReturnType<typeof createInvoicingService>;
