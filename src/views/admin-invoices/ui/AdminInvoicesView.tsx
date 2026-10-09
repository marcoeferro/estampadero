"use client";

import Link from "next/link";
import { useState } from "react";

import { formatCents } from "elestampadero/shared/lib/money";
import { api } from "elestampadero/trpc/react";
import {
  VOUCHER_STATUS_LABELS,
  voucherNumberLabel,
} from "elestampadero/views/admin-orders/ui/OrderInvoicePanel";

import "./admin-invoices.css";

type Status =
  "PENDING" | "PROCESSING" | "AWAITING_AUTHORIZATION" | "ISSUED" | "FAILED";

/** Listado de comprobantes con filtros por fecha, estado y tipo. */
export function AdminInvoicesView() {
  const [status, setStatus] = useState<"" | Status>("");
  const [kind, setKind] = useState<"" | "INVOICE" | "CREDIT_NOTE">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const utils = api.useUtils();
  const query = api.invoicing.adminList.useQuery({
    status: status || undefined,
    kind: kind || undefined,
    from: from || undefined,
    to: to || undefined,
    search: search.trim() || undefined,
    page,
  });
  const retry = api.invoicing.retry.useMutation({
    onSuccess: () => utils.invoicing.adminList.invalidate(),
    onError: (mutationError) => setError(mutationError.message),
  });
  const data = query.data;
  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.pageSize))
    : 1;

  function filter<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  return (
    <div className="admin-invoices">
      {data && !data.enabled ? (
        <p className="admin-invoices__notice">
          La facturación electrónica está desactivada. Se activa con la variable
          INVOICING_PROVIDER cuando estén las credenciales de Facturante.
        </p>
      ) : null}

      <div className="admin-invoices__summary">
        {(
          ["ISSUED", "PENDING", "AWAITING_AUTHORIZATION", "FAILED"] as const
        ).map((key) => (
          <button
            key={key}
            type="button"
            className={status === key ? "is-active" : undefined}
            onClick={() => filter(setStatus)(status === key ? "" : key)}
          >
            <b>{data?.countsByStatus[key] ?? 0}</b>
            <span>{VOUCHER_STATUS_LABELS[key]}</span>
          </button>
        ))}
      </div>

      <div className="admin-invoices__filters">
        <input
          className="admin-input"
          placeholder="Buscar por cliente, documento, CAE o número"
          value={search}
          onChange={(event) => filter(setSearch)(event.target.value)}
        />
        <select
          className="admin-input"
          aria-label="Tipo"
          value={kind}
          onChange={(event) =>
            filter(setKind)(event.target.value as typeof kind)
          }
        >
          <option value="">Facturas y notas de crédito</option>
          <option value="INVOICE">Facturas</option>
          <option value="CREDIT_NOTE">Notas de crédito</option>
        </select>
        <select
          className="admin-input"
          aria-label="Estado"
          value={status}
          onChange={(event) =>
            filter(setStatus)(event.target.value as typeof status)
          }
        >
          <option value="">Todos los estados</option>
          {Object.entries(VOUCHER_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label>
          <span>Desde</span>
          <input
            className="admin-input"
            type="date"
            value={from}
            onChange={(event) => filter(setFrom)(event.target.value)}
          />
        </label>
        <label>
          <span>Hasta</span>
          <input
            className="admin-input"
            type="date"
            value={to}
            onChange={(event) => filter(setTo)(event.target.value)}
          />
        </label>
      </div>

      {error ? (
        <p className="admin-product-modal__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Comprobante</th>
              <th>Pedido</th>
              <th>Cliente</th>
              <th>Importe</th>
              <th>Estado</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {data?.vouchers.map((voucher) => (
              <tr key={voucher.id}>
                <td>
                  {new Date(
                    voucher.issuedAt ?? voucher.createdAt,
                  ).toLocaleDateString("es-AR")}
                </td>
                <td>
                  <strong>{voucher.label}</strong>
                  <small>
                    {voucherNumberLabel(voucher)}
                    {voucher.cae ? ` · CAE ${voucher.cae}` : ""}
                  </small>
                </td>
                <td>
                  <Link href={`/admin/pedidos/${voucher.orderId}`}>
                    #{String(voucher.orderNumber).padStart(6, "0")}
                  </Link>
                </td>
                <td>
                  {voucher.buyerName}
                  <small>
                    {voucher.buyerDocType} {voucher.buyerDocNumber}
                  </small>
                </td>
                <td>
                  {voucher.kind === "CREDIT_NOTE" ? "−" : ""}
                  {formatCents(voucher.amountInCents)}
                </td>
                <td>
                  <span
                    className={`admin-chip ${
                      voucher.status === "ISSUED"
                        ? "admin-chip--success"
                        : voucher.status === "FAILED"
                          ? "admin-chip--danger"
                          : "admin-chip--warning"
                    }`}
                  >
                    {VOUCHER_STATUS_LABELS[voucher.status]}
                  </span>
                  {voucher.errorMessage ? (
                    <small className="admin-invoices__error">
                      {voucher.errorMessage}
                    </small>
                  ) : null}
                </td>
                <td>
                  {voucher.downloadUrl ? (
                    <a
                      className="admin-product-edit"
                      href={voucher.downloadUrl}
                      target="_blank"
                      rel="noopener"
                    >
                      Descargar
                    </a>
                  ) : voucher.status === "FAILED" ||
                    voucher.status === "PENDING" ? (
                    <button
                      type="button"
                      className="admin-product-edit"
                      disabled={retry.isPending}
                      onClick={() => {
                        setError(null);
                        retry.mutate({ voucherId: voucher.id });
                      }}
                    >
                      Reintentar
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {data?.vouchers.length === 0 ? (
              <tr>
                <td colSpan={7} className="admin-products-empty">
                  No hay comprobantes con esos filtros.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <nav className="admin-products-pagination" aria-label="Páginas">
        <button
          type="button"
          disabled={page === 1}
          onClick={() => setPage((current) => current - 1)}
        >
          Anterior
        </button>
        <span>
          Página {page} de {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => setPage((current) => current + 1)}
        >
          Siguiente
        </button>
      </nav>
    </div>
  );
}
