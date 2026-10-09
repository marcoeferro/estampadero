"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { formatCents } from "elestampadero/shared/lib/money";
import {
  AdminAddButton,
  AdminPage,
  AdminPanel,
} from "elestampadero/shared/ui/admin";
import { ConfirmDialog } from "elestampadero/shared/ui/confirm-dialog";
import { ModernSpinner } from "elestampadero/shared/ui/motion";
import { api, type RouterOutputs } from "elestampadero/trpc/react";

import { OrderInvoicePanel } from "./OrderInvoicePanel";

const PAGE_SIZE = 5;
const ORDER_ITEMS_PAGE_SIZE = 4;
const STATUS_OPTIONS = [
  "PENDING_PAYMENT",
  "PAID",
  "IN_PRODUCTION",
  "READY_FOR_SHIPPING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
] as const;
type OrderStatus = (typeof STATUS_OPTIONS)[number];
type OrderDetail = NonNullable<RouterOutputs["orders"]["byId"]>;

const FILTER_OPTIONS = [
  ["", "Todos"],
  ["PENDING_PAYMENT", "Pendientes de pago"],
  ["PAID", "Pagado"],
  ["IN_PRODUCTION", "En producción"],
  ["READY_FOR_SHIPPING", "Listo para envío"],
  ["SHIPPED", "Enviado"],
  ["DELIVERED", "Entregado"],
  ["CANCELLED", "Cancelado"],
] as const;
const STATUS_LABEL = Object.fromEntries(FILTER_OPTIONS) as Record<
  string,
  string
>;





const REFUNDABLE_PAYMENT_STATUSES = new Set(["APPROVED", "PARTIALLY_REFUNDED"]);






const QUERYABLE_PAYMENT_STATUSES = new Set([
  "CREATED",
  "PENDING",
  "PROCESSING",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
]);

function orderChipClass(status: string) {
  if (
    status === "PAID" ||
    status === "READY_FOR_SHIPPING" ||
    status === "SHIPPED" ||
    status === "DELIVERED"
  ) {
    return "admin-chip--success";
  }
  if (status === "CANCELLED") return "admin-chip--danger";
  if (status === "IN_PRODUCTION") return "admin-chip--production";
  return "admin-chip--warning";
}

function paymentLabel(paymentStatus?: string | null) {
  if (!paymentStatus) return "Sin pago iniciado";
  const labels: Record<string, string> = {
    CREATED: "Creado",
    PENDING: "Pendiente",
    PROCESSING: "Procesando",
    APPROVED: "Aprobado",
    REJECTED: "Rechazado",
    CANCELLED: "Pago anulado",
    EXPIRED: "Vencido",
    PARTIALLY_REFUNDED: "Pago reintegrado parcialmente",
    REFUNDED: "Pago reintegrado",
  };
  return labels[paymentStatus] ?? paymentStatus;
}

function RefundActionIcon({ reverse = false }: { reverse?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 7.5h16v10H4zM4 10.5h16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d={reverse ? "m10 15 2.5-2.5L15 15" : "m15 14-2.5 2.5L10 14"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DialogCancelIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path
        d="m7 7 10 10M17 7 7 17"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function AdminOrdersListView({
  initialOrderId = null,
}: {
  initialOrderId?: string | null;
}) {
  const [status, setStatus] = useState<OrderStatus | undefined>();
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [orderTab, setOrderTab] = useState<"active" | "rejected">("active");
  const [isExternalOrderOpen, setIsExternalOrderOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(
    initialOrderId,
  );
  const filters = {
    search: search.trim() || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };
  const activeQuery = api.orders.list.useQuery({
    ...filters,
    paymentCategory: "ACTIVE",
  });
  const rejectedQuery = api.orders.list.useQuery({
    ...filters,
    paymentCategory: "REJECTED",
  });
  const query = orderTab === "active" ? activeQuery : rejectedQuery;
  const orders = query.data ?? [];
  const totalPages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));
  const visibleOrders = orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => setPage(1), [status, search, dateFrom, dateTo, orderTab]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <AdminPage
      module="Módulo de Pedidos"
      title="Gestión de pedidos"
      className="admin-orders-page"
      hideHeader
    >
      <AdminPanel className="admin-panel-pad admin-orders-panel">
        <div className="admin-toolbar admin-orders-toolbar">
          <div>
            <p className="admin-orders-eyebrow">Módulo de Pedidos</p>
            <h1 className="admin-orders-panel-title">Gestión de pedidos</h1>
            <p>{orders.length} pedidos encontrados</p>
          </div>
          <div className="admin-orders-toolbar-actions">
            <AdminAddButton
              type="button"
              className="admin-external-order-button"
              onClick={() => setIsExternalOrderOpen(true)}
            >
              Agregar pedido externo
            </AdminAddButton>
            <details className="admin-orders-status-filter">
              <summary>Todos</summary>
              <select
                className="admin-select"
                aria-label="Filtrar pedidos por estado"
                value={status ?? ""}
                onChange={(event) =>
                  setStatus(
                    (event.target.value || undefined) as
                      OrderStatus | undefined,
                  )
                }
              >
                {FILTER_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </details>
          </div>
        </div>

        <div
          className="admin-orders-tabs"
          role="tablist"
          aria-label="Pedidos por pago"
        >
          <button
            type="button"
            role="tab"
            aria-selected={orderTab === "active"}
            className={orderTab === "active" ? "is-active" : ""}
            onClick={() => setOrderTab("active")}
          >
            <OrderPaymentTabIcon type="approved" />
            <strong>Pagos aprobados</strong>
            <span>{activeQuery.data?.length ?? 0}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={orderTab === "rejected"}
            className={orderTab === "rejected" ? "is-active" : ""}
            onClick={() => setOrderTab("rejected")}
          >
            <OrderPaymentTabIcon type="rejected" />
            <strong>Pagos rechazados</strong>
            <span>{rejectedQuery.data?.length ?? 0}</span>
          </button>
        </div>

        <div className="admin-orders-filters">
          <label>
            <span>Buscar por nombre</span>
            <input
              type="search"
              className="admin-input"
              value={search}
              placeholder="Nombre, DNI, pedido o correo"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            <span>Desde</span>
            <input
              type="date"
              className="admin-input"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </label>
          <label>
            <span>Hasta</span>
            <input
              type="date"
              className="admin-input"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </label>
          {search || dateFrom || dateTo ? (
            <button
              type="button"
              className="admin-btn"
              onClick={() => {
                setSearch("");
                setDateFrom("");
                setDateTo("");
              }}
            >
              Limpiar filtros
            </button>
          ) : null}
        </div>

        <div className="admin-table-wrap admin-orders-table-wrap">
          <table className="admin-table admin-orders-table">
            <thead>
              <tr>
                <th>Productos</th>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Ítems</th>
                <th>Total</th>
                <th>Estado</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {visibleOrders.map((order) => (
                <tr
                  key={order.id}
                  className="admin-order-row"
                  tabIndex={0}
                  onClick={() => setSelectedOrderId(order.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedOrderId(order.id);
                    }
                  }}
                >
                  <td>
                    <OrderThumbnails imageUrls={order.imageUrls} />
                  </td>
                  <td>
                    <strong>
                      #{String(order.orderNumber).padStart(6, "0")}
                    </strong>
                    <small>
                      {new Date(order.createdAt).toLocaleDateString("es-AR")}
                    </small>
                  </td>
                  <td>
                    <strong>{order.contactName}</strong>
                    <small>{order.contactEmail}</small>
                  </td>
                  <td>
                    <strong>{order.itemCount}</strong>
                  </td>
                  <td>
                    <strong>{formatCents(order.totalInCents)}</strong>
                  </td>
                  <td>
                    <span
                      className={`admin-chip ${orderChipClass(order.status)}`}
                    >
                      {STATUS_LABEL[order.status] ?? order.status}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="admin-order-view-button"
                      onClick={() => setSelectedOrderId(order.id)}
                    >
                      Ver detalle
                    </button>
                  </td>
                </tr>
              ))}
              {!query.isLoading && visibleOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="admin-orders-empty">
                    No hay pedidos con este filtro.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {query.isLoading ? (
            <div className="admin-orders-loading">
              <ModernSpinner label="Cargando..." />
            </div>
          ) : null}
        </div>

        <nav
          className="admin-orders-pagination"
          aria-label="Páginas de pedidos"
        >
          <button
            type="button"
            disabled={page === 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Anterior
          </button>
          <span>
            Página {page} de {totalPages}
          </span>
          <button
            type="button"
            disabled={page === totalPages}
            onClick={() =>
              setPage((current) => Math.min(totalPages, current + 1))
            }
          >
            Siguiente
          </button>
        </nav>
      </AdminPanel>

      {selectedOrderId ? (
        <AdminOrderDetailModal
          orderId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
        />
      ) : null}
      {isExternalOrderOpen ? (
        <ExternalOrderModal onClose={() => setIsExternalOrderOpen(false)} />
      ) : null}
    </AdminPage>
  );
}

function ExternalOrderModal({ onClose }: { onClose: () => void }) {
  const utils = api.useUtils();
  const productsQuery = api.catalog.adminList.useQuery();
  const createOrder = api.orders.createExternal.useMutation({
    onSuccess: async () => {
      await utils.orders.list.invalidate();
      onClose();
    },
  });
  const products = productsQuery.data ?? [];
  const [contactName, setContactName] = useState("");
  const [customerDocument, setCustomerDocument] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<"SHIPPING" | "PICKUP">(
    "PICKUP",
  );
  const [shippingAddress, setShippingAddress] = useState("");
  const [shippingCity, setShippingCity] = useState("");
  const [shippingPostalCode, setShippingPostalCode] = useState("");
  const [items, setItems] = useState([{ variantId: "", quantity: 1 }]);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = () => {
    setNotice(null);
    createOrder.mutate(
      {
        contactName,
        customerDocument: customerDocument || null,
        contactEmail,
        contactPhone,
        deliveryMethod,
        shippingAddress: deliveryMethod === "SHIPPING" ? shippingAddress : null,
        shippingCity: deliveryMethod === "SHIPPING" ? shippingCity : null,
        shippingPostalCode:
          deliveryMethod === "SHIPPING" ? shippingPostalCode : null,
        items,
      },
      { onError: (error) => setNotice(error.message) },
    );
  };

  return createPortal(
    <div className="admin-order-modal-backdrop">
      <section
        className="admin-order-modal admin-external-order-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="external-order-title"
      >
        <header className="admin-order-modal__header">
          <div>
            <span>Administración</span>
            <h2 id="external-order-title">Agregar pedido externo</h2>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="admin-order-modal__body">
          <div className="admin-external-order-form">
            <label>
              Nombre del cliente
              <input
                className="admin-input"
                value={contactName}
                onChange={(event) => setContactName(event.target.value)}
              />
            </label>
            <label>
              Email
              <input
                type="email"
                className="admin-input"
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
              />
            </label>
            <label>
              DNI <span>(opcional)</span>
              <input
                className="admin-input"
                value={customerDocument}
                onChange={(event) => setCustomerDocument(event.target.value)}
              />
            </label>
            <label>
              Teléfono
              <input
                className="admin-input"
                value={contactPhone}
                onChange={(event) => setContactPhone(event.target.value)}
              />
            </label>
            <label>
              Tipo de envío
              <select
                className="admin-select"
                value={deliveryMethod}
                onChange={(event) =>
                  setDeliveryMethod(event.target.value as "SHIPPING" | "PICKUP")
                }
              >
                <option value="PICKUP">Retiro en el taller</option>
                <option value="SHIPPING">Envío</option>
              </select>
            </label>
            {deliveryMethod === "SHIPPING" ? (
              <>
                <label>
                  Dirección
                  <input
                    className="admin-input"
                    value={shippingAddress}
                    onChange={(event) => setShippingAddress(event.target.value)}
                  />
                </label>
                <label>
                  Ciudad
                  <input
                    className="admin-input"
                    value={shippingCity}
                    onChange={(event) => setShippingCity(event.target.value)}
                  />
                </label>
                <label>
                  Código postal
                  <input
                    className="admin-input"
                    value={shippingPostalCode}
                    onChange={(event) =>
                      setShippingPostalCode(event.target.value)
                    }
                  />
                </label>
              </>
            ) : null}
          </div>
          <div className="admin-external-order-items">
            <h3>Productos</h3>
            {items.map((item, index) => (
              <div className="admin-external-order-item" key={index}>
                <select
                  className="admin-select"
                  value={item.variantId}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((value, itemIndex) =>
                        itemIndex === index
                          ? { ...value, variantId: event.target.value }
                          : value,
                      ),
                    )
                  }
                >
                  <option value="">Seleccionar producto y variante</option>
                  {products.flatMap((product) =>
                    product.variants.map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {product.name} · {variant.size} · {variant.color}
                      </option>
                    )),
                  )}
                </select>
                <input
                  type="number"
                  min={1}
                  className="admin-input"
                  value={item.quantity}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((value, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...value,
                              quantity: Math.max(1, Number(event.target.value)),
                            }
                          : value,
                      ),
                    )
                  }
                />
                {items.length > 1 ? (
                  <button
                    type="button"
                    className="admin-btn"
                    onClick={() =>
                      setItems((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    Quitar
                  </button>
                ) : null}
              </div>
            ))}
            <button
              type="button"
              className="admin-btn"
              onClick={() =>
                setItems((current) => [
                  ...current,
                  { variantId: "", quantity: 1 },
                ])
              }
            >
              + Agregar producto
            </button>
          </div>
          {notice ? (
            <div className="admin-toast admin-toast--error" role="alert">
              {notice}
            </div>
          ) : null}
          <div className="admin-external-order-actions">
            <button type="button" className="admin-btn" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              disabled={createOrder.isPending || productsQuery.isLoading}
              onClick={submit}
            >
              {createOrder.isPending ? "Guardando…" : "Crear pedido"}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function OrderThumbnails({ imageUrls }: { imageUrls: string[] }) {
  return (
    <span className="admin-order-thumbnails">
      {imageUrls.length ? (
        imageUrls.map((url, index) => (
          <span key={`${url}-${index}`}>
            <Image src={url} alt="" fill sizes="64px" />
          </span>
        ))
      ) : (
        <small>Sin imagen</small>
      )}
    </span>
  );
}

function OrderPaymentTabIcon({ type }: { type: "approved" | "rejected" }) {
  const path =
    type === "approved"
      ? "M20 11.2V12a8 8 0 1 1-4.75-7.32M20 4v5h-5M8.5 12.5l2.2 2.2 4.8-5"
      : "M8.5 8.5l7 7m0-7-7 7M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z";
  return (
    <span className="admin-orders-tab-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <path
          d={path}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function OrderCardIcon({
  type,
}: {
  type: "user" | "calendar" | "status" | "payment" | "summary" | "bag";
}) {
  const paths: Record<string, string> = {
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
    calendar: "M5 5h14v14H5zM8 3v4m8-4v4M5 9h14",
    status: "M6 4h12v16H6zM9 8h6m-6 4h6m-6 4h4",
    payment: "M4 8h16M6 5h12a2 2 0 0 1 2 2v10H4V7a2 2 0 0 1 2-2Zm2 8h4",
    summary: "M6 3h12v18H6zM9 7h6m-6 4h6m-6 4h4",
    bag: "M6 8h12l1 12H5L6 8Zm3 0a3 3 0 0 1 6 0",
  };
  return (
    <span className="admin-order-card-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <path
          d={paths[type]}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function AdminOrderDetailModal({
  orderId,
  onClose,
}: {
  orderId: string;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const utils = api.useUtils();
  const orderQuery = api.orders.byId.useQuery({ id: orderId });
  const [nextStatus, setNextStatus] = useState<OrderStatus | null>(null);
  const [isStatusConfirmOpen, setIsStatusConfirmOpen] = useState(false);
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false);
  const [isRefundConfirmOpen, setIsRefundConfirmOpen] = useState(false);
  const [isVoidRefundConfirmOpen, setIsVoidRefundConfirmOpen] = useState(false);



  const [refundAmountPesos, setRefundAmountPesos] = useState("");
  const [providerRefundId, setProviderRefundId] = useState("");
  const updateStatus = api.orders.updateStatus.useMutation({
    onSuccess: async () => {
      setNextStatus(null);
      await Promise.all([
        utils.orders.byId.invalidate({ id: orderId }),
        utils.orders.list.invalidate(),
      ]);
    },
  });
  const refundPayment = api.payments.refundPayment.useMutation({
    onSuccess: async () => {
      setIsRefundConfirmOpen(false);
      setRefundAmountPesos("");
      await Promise.all([
        utils.orders.byId.invalidate({ id: orderId }),
        utils.orders.list.invalidate(),
      ]);
    },
  });
  const queryPaymentStatus = api.payments.queryPaymentStatus.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.orders.byId.invalidate({ id: orderId }),
        utils.orders.list.invalidate(),
      ]);
    },
  });
  const voidRefund = api.payments.voidRefund.useMutation({
    onSuccess: async () => {
      setIsVoidRefundConfirmOpen(false);
      await Promise.all([
        utils.orders.byId.invalidate({ id: orderId }),
        utils.orders.list.invalidate(),
      ]);
    },
  });
  const setRefundReference = api.payments.setRefundReference.useMutation({
    onSuccess: async () => {
      setProviderRefundId("");
      await Promise.all([
        utils.orders.byId.invalidate({ id: orderId }),
        utils.orders.list.invalidate(),
      ]);
    },
  });
  const order = orderQuery.data;
  const hasUnsavedStatus = Boolean(nextStatus && nextStatus !== order?.status);

  const requestClose = () => {
    if (hasUnsavedStatus) {
      setIsDiscardConfirmOpen(true);
      return;
    }
    onClose();
  };

  useEffect(() => {
    if (!hasUnsavedStatus) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedStatus]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <div className="admin-order-modal-backdrop">
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-order-modal-title"
          className="admin-order-modal"
        >
          <header className="admin-order-modal__header">
            <div>
              <span>Detalle del pedido</span>
              <h2 id="admin-order-modal-title">
                {order
                  ? `Pedido #${String(order.orderNumber).padStart(6, "0")}`
                  : "Cargando..."}
              </h2>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              aria-label="Cerrar detalle del pedido"
              onClick={requestClose}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 6l12 12M18 6 6 18"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </header>

          <div className="admin-order-modal__body">
            {orderQuery.isLoading ? (
              <div className="admin-order-modal__loading">
                <ModernSpinner label="Cargando..." />
              </div>
            ) : order ? (
              <OrderModalContent
                order={order}
                nextStatus={nextStatus}
                isUpdating={updateStatus.isPending}
                onStatusChange={setNextStatus}
                onUpdate={() => setIsStatusConfirmOpen(true)}
                isRefunding={refundPayment.isPending}
                refundError={refundPayment.error?.message ?? null}
                refundAmountPesos={refundAmountPesos}
                onRefundAmountChange={setRefundAmountPesos}
                onRefund={() => {
                  if (!order.payment) return;
                  setIsRefundConfirmOpen(true);
                }}
                isQueryingStatus={queryPaymentStatus.isPending}
                queryStatusError={queryPaymentStatus.error?.message ?? null}
                queryStatusResult={queryPaymentStatus.data ?? null}
                onQueryStatus={() => {
                  if (!order.payment) return;
                  queryPaymentStatus.mutate({ paymentId: order.payment.id });
                }}
                isVoidingRefund={voidRefund.isPending}
                voidRefundError={voidRefund.error?.message ?? null}
                onVoidRefund={() => {
                  if (!order.payment) return;
                  setIsVoidRefundConfirmOpen(true);
                }}
                providerRefundId={providerRefundId}
                onProviderRefundIdChange={setProviderRefundId}
                isSavingRefundReference={setRefundReference.isPending}
                refundReferenceError={setRefundReference.error?.message ?? null}
                onSaveRefundReference={() => {
                  if (!order.payment) return;
                  setRefundReference.mutate({
                    paymentId: order.payment.id,
                    providerRefundId,
                  });
                }}
              />
            ) : (
              <p className="admin-orders-empty">Pedido no encontrado.</p>
            )}
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={isStatusConfirmOpen}
        title="Confirmar cambio de estado"
        message={`¿Estás seguro de cambiar el estado de este pedido a “${nextStatus ? STATUS_LABEL[nextStatus] : ""}”?`}
        confirmLabel="Sí, guardar cambio"
        cancelLabel="Revisar"
        danger={false}
        isConfirming={updateStatus.isPending}
        confirmingLabel="Guardando…"
        onCancel={() => setIsStatusConfirmOpen(false)}
        onConfirm={() => {
          if (!order || !nextStatus) return;
          updateStatus.mutate(
            { id: order.id, status: nextStatus },
            { onSuccess: () => setIsStatusConfirmOpen(false) },
          );
        }}
      />

      <ConfirmDialog
        open={isDiscardConfirmOpen}
        title="Cambios sin guardar"
        message="Hay un cambio de estado seleccionado que todavía no se guardó. Si salís ahora, se perderá."
        confirmLabel="Salir sin guardar"
        cancelLabel="Seguir editando"
        onCancel={() => setIsDiscardConfirmOpen(false)}
        onConfirm={() => {
          setIsDiscardConfirmOpen(false);
          onClose();
        }}
      />

      <ConfirmDialog
        open={isRefundConfirmOpen}
        className="admin-confirm-dialog--refund"
        title="Confirmar reintegro"
        message={
          refundAmountPesos.trim()
            ? `¿Reintegrar ${Number(refundAmountPesos).toLocaleString("es-AR", { style: "currency", currency: "ARS" })} al cliente? Payway descontará ese importe del saldo cobrado.`
            : "¿Reintegrar al cliente todo el saldo pendiente de este pago? Payway definirá automáticamente si corresponde una anulación o una devolución."
        }
        confirmLabel={
          refundAmountPesos.trim()
            ? "Sí, reintegrar monto"
            : "Sí, reintegrar todo"
        }
        cancelLabel="Cancelar"
        icon={<RefundActionIcon />}
        cancelIcon={<DialogCancelIcon />}
        confirmIcon={<RefundActionIcon />}
        isConfirming={refundPayment.isPending}
        confirmingLabel="Procesando…"
        onCancel={() => setIsRefundConfirmOpen(false)}
        onConfirm={() => {
          if (!order?.payment) return;
          const trimmed = refundAmountPesos.trim();
          const amountInCents = trimmed
            ? Math.round(Number(trimmed) * 100)
            : undefined;
          refundPayment.mutate({ paymentId: order.payment.id, amountInCents });
        }}
      />

      <ConfirmDialog
        open={isVoidRefundConfirmOpen}
        className="admin-confirm-dialog--refund admin-confirm-dialog--refund-reversal"
        title="Revertir último reintegro"
        message="¿Revertir el último reintegro? El reintegro dejará de estar vigente en Payway y el importe volverá a figurar como cobrado."
        confirmLabel="Sí, revertir reintegro"
        cancelLabel="Cancelar"
        icon={<RefundActionIcon reverse />}
        cancelIcon={<DialogCancelIcon />}
        confirmIcon={<RefundActionIcon reverse />}
        isConfirming={voidRefund.isPending}
        confirmingLabel="Procesando…"
        onCancel={() => setIsVoidRefundConfirmOpen(false)}
        onConfirm={() => {
          if (!order?.payment) return;
          voidRefund.mutate({ paymentId: order.payment.id });
        }}
      />
    </>,
    document.body,
  );
}

function OrderStatusSelect({
  value,
  onChange,
}: {
  value: OrderStatus;
  onChange: (status: OrderStatus) => void;
}) {
  return (
    <details className="admin-order-status-select">
      <summary aria-label="Estado del pedido">
        <span>{STATUS_LABEL[value]}</span>
      </summary>
      <div
        className="admin-order-status-select__menu"
        role="listbox"
        aria-label="Estados disponibles"
      >
        {STATUS_OPTIONS.map((status) => (
          <button
            key={status}
            type="button"
            role="option"
            aria-selected={status === value}
            className={status === value ? "is-selected" : ""}
            onClick={(event) => {
              onChange(status);
              event.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            <span
              className={`admin-order-status-dot admin-order-status-dot--${status.toLowerCase()}`}
            />
            {STATUS_LABEL[status]}
            {status === value ? (
              <span className="admin-order-status-check">✓</span>
            ) : null}
          </button>
        ))}
      </div>
    </details>
  );
}

function OrderModalContent({
  order,
  nextStatus,
  isUpdating,
  onStatusChange,
  onUpdate,
  isRefunding,
  refundError,
  refundAmountPesos,
  onRefundAmountChange,
  onRefund,
  isQueryingStatus,
  queryStatusError,
  queryStatusResult,
  onQueryStatus,
  isVoidingRefund,
  voidRefundError,
  onVoidRefund,
  providerRefundId,
  onProviderRefundIdChange,
  isSavingRefundReference,
  refundReferenceError,
  onSaveRefundReference,
}: {
  order: OrderDetail;
  nextStatus: OrderStatus | null;
  isUpdating: boolean;
  onStatusChange: (status: OrderStatus) => void;
  onUpdate: () => void;
  isRefunding: boolean;
  refundError: string | null;
  refundAmountPesos: string;
  onRefundAmountChange: (value: string) => void;
  onRefund: () => void;
  isQueryingStatus: boolean;
  queryStatusError: string | null;
  queryStatusResult: { status: string; changed: boolean } | null;
  onQueryStatus: () => void;
  isVoidingRefund: boolean;
  voidRefundError: string | null;
  onVoidRefund: () => void;
  providerRefundId: string;
  onProviderRefundIdChange: (value: string) => void;
  isSavingRefundReference: boolean;
  refundReferenceError: string | null;
  onSaveRefundReference: () => void;
}) {
  const units = order.items.reduce((total, item) => total + item.quantity, 0);
  const [itemsPage, setItemsPage] = useState(1);
  const address =
    order.deliveryMethod === "SHIPPING"
      ? [order.shippingAddress, order.shippingCity, order.shippingPostalCode]
          .filter(Boolean)
          .join(" · ")
      : "Retiro en el taller";
  const itemsPageCount = Math.max(
    1,
    Math.ceil(order.items.length / ORDER_ITEMS_PAGE_SIZE),
  );
  const visibleItems = order.items.slice(
    (itemsPage - 1) * ORDER_ITEMS_PAGE_SIZE,
    itemsPage * ORDER_ITEMS_PAGE_SIZE,
  );
  const firstVisibleItem = (itemsPage - 1) * ORDER_ITEMS_PAGE_SIZE + 1;
  const lastVisibleItem = Math.min(
    itemsPage * ORDER_ITEMS_PAGE_SIZE,
    order.items.length,
  );

  useEffect(() => setItemsPage(1), [order.id]);

  useEffect(() => {
    if (itemsPage > itemsPageCount) setItemsPage(itemsPageCount);
  }, [itemsPage, itemsPageCount]);

  return (
    <>
      <div className="admin-order-modal__heading">
        <div>
          <OrderCardIcon type="user" />
          <span>Cliente</span>
          <strong>{order.contactName}</strong>
          <small>{order.contactEmail}</small>
          <small>{order.contactPhone}</small>
          {order.customerDocument ? (
            <small>DNI {order.customerDocument}</small>
          ) : null}
        </div>
        <div className="admin-order-modal__order-info">
          <OrderCardIcon type="calendar" />
          <span>Fecha y envío</span>
          <strong>
            {new Date(order.createdAt).toLocaleString("es-AR", {
              dateStyle: "long",
              timeStyle: "short",
            })}
          </strong>
          <small>{address}</small>
        </div>
        <div className="admin-order-modal__status-actions">
          <OrderCardIcon type="status" />
          <span>Estado del pedido</span>
          <div>
            <OrderStatusSelect
              value={(nextStatus ?? order.status) as OrderStatus}
              onChange={onStatusChange}
            />
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              disabled={
                !nextStatus || nextStatus === order.status || isUpdating
              }
              onClick={onUpdate}
            >
              {isUpdating ? "Guardando…" : "Actualizar"}
            </button>
          </div>
        </div>
      </div>

      <div className="admin-order-modal__overview">
        <section className="admin-order-modal__payment">
          <header>
            <div>
              <OrderCardIcon type="payment" />
              <span>Pago</span>
              <strong>{paymentLabel(order.payment?.status)}</strong>
            </div>
            {order.payment ? (
              <span className="admin-order-modal__payment-amount">
                {formatCents(order.payment.amountInCents)}
              </span>
            ) : null}
          </header>
          {order.payment ? (
            <small>
              {order.payment.channel.replaceAll("_", " ")}
              {order.payment.paymentMethodType
                ? ` · ${order.payment.paymentMethodType === "credit_card" ? "crédito" : order.payment.paymentMethodType === "debit_card" ? "débito" : order.payment.paymentMethodType}`
                : ""}
              {(order.payment.installments ?? 0) > 1
                ? ` · ${order.payment.installments} cuotas`
                : ""}
              {order.payment.amountRefundedInCents > 0
                ? ` · Devuelto: ${formatCents(order.payment.amountRefundedInCents)}`
                : ""}
            </small>
          ) : (
            <div className="admin-order-payment-empty">
              <strong>Este pedido todavía no tiene un pago asociado.</strong>
              <span>
                Solo los pagos aprobados pasan automáticamente a producción.
              </span>
            </div>
          )}
          {(order.payment?.provider === "PAYWAY" ||
            order.payment?.provider === "MOBBEX") &&
          REFUNDABLE_PAYMENT_STATUSES.has(order.payment.status) ? (
            <div className="admin-order-modal__refund">
              <label className="admin-order-modal__refund-amount">
                <span>Importe a reintegrar</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  placeholder="Dejar vacío para reintegrar todo"
                  value={refundAmountPesos}
                  disabled={isRefunding}
                  onChange={(event) => onRefundAmountChange(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="admin-btn admin-btn--danger"
                disabled={isRefunding}
                onClick={onRefund}
              >
                {isRefunding
                  ? "Procesando…"
                  : refundAmountPesos.trim()
                    ? "Reintegrar monto"
                    : "Reintegrar saldo completo"}
              </button>
              <small className="admin-order-modal__refund-help">
                La pasarela procesa el reintegro sobre el mismo medio utilizado
                para pagar.
              </small>
              {refundError ? (
                <small className="admin-order-modal__refund-error">
                  {refundError}
                </small>
              ) : null}
            </div>
          ) : null}
          {(order.payment?.provider === "PAYWAY" ||
            order.payment?.provider === "MOBBEX") &&
          QUERYABLE_PAYMENT_STATUSES.has(order.payment.status) ? (
            <div className="admin-order-modal__refund">
              <button
                type="button"
                className="admin-btn"
                disabled={isQueryingStatus}
                onClick={onQueryStatus}
              >
                {isQueryingStatus ? "Consultando…" : "Consultar estado"}
              </button>
              {queryStatusResult ? (
                <small>
                  {queryStatusResult.changed
                    ? `Actualizado: ${paymentLabel(queryStatusResult.status)}`
                    : `Sin cambios: sigue ${paymentLabel(queryStatusResult.status)}`}
                </small>
              ) : null}
              {queryStatusError ? (
                <small className="admin-order-modal__refund-error">
                  {queryStatusError}
                </small>
              ) : null}
            </div>
          ) : null}
          {order.payment?.provider === "PAYWAY" &&
          order.payment.lastProviderRefundId ? (
            <div className="admin-order-modal__refund">
              <div className="admin-order-modal__payment-action-copy">
                <strong>Revertir último reintegro</strong>
                <small>
                  Cancela en Payway el último reintegro realizado. No genera un
                  reintegro nuevo.
                </small>
              </div>
              <button
                type="button"
                className="admin-btn admin-btn--danger"
                disabled={isVoidingRefund}
                onClick={onVoidRefund}
              >
                {isVoidingRefund ? "Procesando…" : "Revertir reintegro"}
              </button>
              {voidRefundError ? (
                <small className="admin-order-modal__refund-error">
                  {voidRefundError}
                </small>
              ) : null}
            </div>
          ) : null}
          {order.payment?.provider === "PAYWAY" &&
          order.payment.status === "REFUNDED" &&
          !order.payment.lastProviderRefundId ? (
            <div className="admin-order-modal__refund">
              <label className="admin-order-modal__refund-amount">
                <span>ID de devolución de Payway</span>
                <input
                  value={providerRefundId}
                  placeholder="ID devuelto por Payway en el Caso 9"
                  disabled={isSavingRefundReference}
                  onChange={(event) =>
                    onProviderRefundIdChange(event.target.value)
                  }
                />
              </label>
              <button
                type="button"
                className="admin-btn"
                disabled={isSavingRefundReference || !providerRefundId.trim()}
                onClick={onSaveRefundReference}
              >
                {isSavingRefundReference
                  ? "Guardando…"
                  : "Guardar ID de devolución"}
              </button>
              {refundReferenceError ? (
                <small className="admin-order-modal__refund-error">
                  {refundReferenceError}
                </small>
              ) : null}
            </div>
          ) : null}
          <OrderInvoicePanel
            orderId={order.id}
            isPaid={REFUNDABLE_PAYMENT_STATUSES.has(order.payment?.status ?? "")}
          />
        </section>

        <section className="admin-order-modal__totals">
          <header>
            <div>
              <OrderCardIcon type="summary" />
              <span>Resumen del pedido</span>
              <strong>
                {order.items.length} producto
                {order.items.length === 1 ? "" : "s"} · {units} unidad
                {units === 1 ? "" : "es"}
              </strong>
            </div>
          </header>
          <dl>
            <div>
              <dt>Subtotal</dt>
              <dd>{formatCents(order.subtotalInCents)}</dd>
            </div>
            <div>
              <dt>Envío</dt>
              <dd>{formatCents(order.shippingInCents)}</dd>
            </div>
            <div className="is-total">
              <dt>Total</dt>
              <dd>{formatCents(order.totalInCents)}</dd>
            </div>
          </dl>
          <div className="admin-order-modal__info-box">
            <strong>ⓘ Información importante</strong>
            <p>
              Los cambios en el estado del pedido se verán reflejados en el
              historial y las notificaciones del cliente.
            </p>
          </div>
        </section>
      </div>

      <section className="admin-order-modal__products">
        <header>
          <div>
            <h3>
              <OrderCardIcon type="bag" />
              Productos del pedido
            </h3>
            <span>
              {units} unidad{units === 1 ? "" : "es"} en total
            </span>
          </div>
          {order.items.length > 0 ? (
            <span>
              Mostrando {firstVisibleItem}–{lastVisibleItem} de{" "}
              {order.items.length}
            </span>
          ) : null}
        </header>
        <div className="admin-order-modal__product-list">
          {visibleItems.map((item) => (
            <article key={item.id}>
              <span className="admin-order-product-image">
                {item.imageUrl ? (
                  <Image src={item.imageUrl} alt="" fill sizes="76px" />
                ) : (
                  <small>Sin imagen</small>
                )}
              </span>
              <div>
                <strong>{item.productName}</strong>
                <small>
                  Talle {item.size} · Color {item.color}
                  {item.clubNameSnapshot ? ` · ${item.clubNameSnapshot}` : ""}
                </small>
              </div>
              <div>
                <span>Cantidad</span>
                <strong>{item.quantity}</strong>
              </div>
              <div>
                <span>Precio unitario</span>
                <strong>{formatCents(item.priceInCentsSnapshot)}</strong>
              </div>
              <div>
                <span>Subtotal</span>
                <strong>{formatCents(item.lineTotalInCents)}</strong>
              </div>
            </article>
          ))}
        </div>
        {itemsPageCount > 1 ? (
          <nav
            className="admin-order-modal__products-pagination"
            aria-label="Páginas de productos del pedido"
          >
            <button
              type="button"
              disabled={itemsPage === 1}
              onClick={() =>
                setItemsPage((current) => Math.max(1, current - 1))
              }
            >
              Anterior
            </button>
            <span>
              Página {itemsPage} de {itemsPageCount}
            </span>
            <button
              type="button"
              disabled={itemsPage === itemsPageCount}
              onClick={() =>
                setItemsPage((current) => Math.min(itemsPageCount, current + 1))
              }
            >
              Siguiente
            </button>
          </nav>
        ) : null}
      </section>
    </>
  );
}
