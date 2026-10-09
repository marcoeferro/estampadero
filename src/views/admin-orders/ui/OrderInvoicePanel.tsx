"use client";

import { useState } from "react";

import { formatCents } from "elestampadero/shared/lib/money";
import { api } from "elestampadero/trpc/react";

import "elestampadero/views/admin-invoices/ui/admin-invoices.css";

export const VOUCHER_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  PROCESSING: "Enviando",
  AWAITING_AUTHORIZATION: "Esperando ARCA",
  ISSUED: "Emitido",
  FAILED: "Con error",
};

export function voucherNumberLabel(voucher: {
  pointOfSale: number | null;
  number: number | null;
}) {
  if (voucher.number === null) return "—";
  return `${String(voucher.pointOfSale ?? 0).padStart(5, "0")}-${String(
    voucher.number,
  ).padStart(8, "0")}`;
}

/** Estado de la factura y notas de crédito de un pedido, con acciones. */
export function OrderInvoicePanel({
  orderId,
  isPaid,
}: {
  orderId: string;
  isPaid: boolean;
}) {
  const utils = api.useUtils();
  const [error, setError] = useState<string | null>(null);
  const query = api.invoicing.adminForOrder.useQuery({ orderId });
  const refresh = async () => {
    setError(null);
    await utils.invoicing.adminForOrder.invalidate({ orderId });
  };
  const retry = api.invoicing.retry.useMutation({
    onSuccess: refresh,
    onError: (mutationError) => setError(mutationError.message),
  });
  const issue = api.invoicing.issueForOrder.useMutation({
    onSuccess: refresh,
    onError: (mutationError) => setError(mutationError.message),
  });

  if (!query.data) return null;
  const { enabled, vouchers } = query.data;
  const hasInvoice = vouchers.some((voucher) => voucher.kind === "INVOICE");

  return (
    <section className="admin-order-invoices">
      <header>
        <strong>Facturación</strong>
        {!enabled ? <small>Facturación electrónica desactivada</small> : null}
      </header>
      {vouchers.length ? (
        <ul>
          {vouchers.map((voucher) => (
            <li key={voucher.id}>
              <div>
                <strong>
                  {voucher.label} {voucherNumberLabel(voucher)}
                </strong>
                <span
                  className={`admin-chip ${
                    voucher.status === "ISSUED"
                      ? "admin-chip--success"
                      : voucher.status === "FAILED"
                        ? "admin-chip--danger"
                        : "admin-chip--warning"
                  }`}
                >
                  {VOUCHER_STATUS_LABELS[voucher.status] ?? voucher.status}
                </span>
              </div>
              <small>
                {formatCents(voucher.amountInCents)} · {voucher.buyerName} (
                {voucher.buyerDocType} {voucher.buyerDocNumber})
                {voucher.cae ? ` · CAE ${voucher.cae}` : ""}
                {voucher.provider === "simulated"
                  ? " · prueba sin validez fiscal"
                  : ""}
              </small>
              {voucher.errorMessage ? (
                <small className="admin-order-invoices__error">
                  {voucher.errorMessage}
                  {voucher.status === "PENDING"
                    ? ` · próximo intento ${new Date(voucher.nextAttemptAt).toLocaleString("es-AR")}`
                    : ""}
                </small>
              ) : null}
              <div className="admin-order-invoices__actions">
                {voucher.downloadUrl ? (
                  <a href={voucher.downloadUrl} target="_blank" rel="noopener">
                    Descargar
                  </a>
                ) : null}
                {enabled &&
                (voucher.status === "FAILED" ||
                  voucher.status === "PENDING") ? (
                  <button
                    type="button"
                    disabled={retry.isPending}
                    onClick={() => retry.mutate({ voucherId: voucher.id })}
                  >
                    Reintentar ahora
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <small>Todavía no hay comprobantes para este pedido.</small>
      )}
      {enabled && isPaid && !hasInvoice ? (
        <button
          type="button"
          className="admin-btn"
          disabled={issue.isPending}
          onClick={() => issue.mutate({ orderId })}
        >
          Emitir factura
        </button>
      ) : null}
      {error ? (
        <small className="admin-order-invoices__error">{error}</small>
      ) : null}
    </section>
  );
}
