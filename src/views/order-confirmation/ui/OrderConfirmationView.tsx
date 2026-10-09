import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { routes } from "elestampadero/shared/config/routes";
import { formatCents } from "elestampadero/shared/lib/money";
import { BackLink, Badge, Container } from "elestampadero/shared/ui";
import { PaymentMethodPanel } from "elestampadero/widgets/payment-method-panel";
import { StoreHeader } from "elestampadero/widgets/store-header";
import { api } from "elestampadero/trpc/server";

import { PaidOrderCartCleanup } from "./PaidOrderCartCleanup";
import { PendingPaymentRefresh } from "./PendingPaymentRefresh";
import { PrintReceiptButton } from "./PrintReceiptButton";
import { EnsureReceiptEmail } from "./EnsureReceiptEmail";

interface OrderConfirmationViewProps {
  orderId: string;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: "Pendiente de pago",
  PAID: "Pagado",
  IN_PRODUCTION: "En producción",
  READY_FOR_SHIPPING: "Listo para envío",
  SHIPPED: "Enviado",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado",
};

function statusBadgeClass(status: string) {
  if (
    status === "PAID" ||
    status === "READY_FOR_SHIPPING" ||
    status === "SHIPPED" ||
    status === "DELIVERED"
  ) {
    return "status-badge--success";
  }
  if (status === "IN_PRODUCTION") return "status-badge--production";
  if (status === "CANCELLED") return "status-badge--danger";
  return "status-badge--waiting";
}

const PAID_STATUSES = new Set([
  "PAID",
  "IN_PRODUCTION",
  "READY_FOR_SHIPPING",
  "SHIPPED",
  "DELIVERED",
]);

export async function OrderConfirmationView({
  orderId,
}: OrderConfirmationViewProps) {
  const order = await api.orders.byId({ id: orderId });
  if (!order) notFound();
  const isPaid = PAID_STATUSES.has(order.status);
  const vouchers = await api.invoicing.forOrder({ orderId: order.id });

  return (
    <div className="bg-paper flex min-h-screen flex-col">
      {isPaid ? (
        <>
          <PaidOrderCartCleanup
            orderId={order.id}
            lines={order.items.map((item) => ({
              productId: item.productId,
              size: item.size,
              color: item.color,
              quantity: item.quantity,
            }))}
          />
          <EnsureReceiptEmail
            orderId={order.id}
            alreadySent={Boolean(order.receiptEmailSentAt)}
          />
        </>
      ) : null}
      {order.status === "PENDING_PAYMENT" ? <PendingPaymentRefresh /> : null}
      <StoreHeader />
      <main className="flex-1">
        <Container className="py-6 md:py-10">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 md:mb-6">
            <div>
              {!isPaid ? (
                <BackLink
                  fallback={routes.checkout}
                  className="catalog-back-link mb-3"
                />
              ) : null}
              <span className="text-muted font-mono text-xs uppercase">
                Pedido #{String(order.orderNumber).padStart(6, "0")}
              </span>
              <h1 className="font-display text-ink text-[26px] font-black md:text-2xl">
                ¡Gracias, {order.contactName.split(" ")[0]}!
              </h1>
            </div>
            <Badge className={statusBadgeClass(order.status)}>
              {STATUS_LABEL[order.status] ?? order.status}
            </Badge>
          </div>

          <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
            <div className="flex flex-col divide-y divide-black/5 rounded-lg bg-white">
              {order.items.map((item) => (
                <div key={item.id} className="flex gap-3.5 p-4 md:gap-4">
                  <div className="bg-paper relative h-14 w-14 shrink-0 overflow-hidden rounded-lg md:h-16 md:w-16">
                    {item.imageUrl ? (
                      <Image
                        src={item.imageUrl}
                        alt={item.productName}
                        fill
                        className="object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="flex-1">
                    <p className="text-ink font-semibold">{item.productName}</p>
                    <p className="text-muted text-xs">
                      Talle {item.size} · {item.color} · {item.quantity} unidad
                      {item.quantity === 1 ? "" : "es"}
                    </p>
                  </div>
                  <span className="font-display text-deep font-bold">
                    {formatCents(item.lineTotalInCents)}
                  </span>
                </div>
              ))}
            </div>

            <div className="h-fit rounded-lg bg-white p-4 md:p-5">
              <h2 className="font-display mb-3 text-lg font-bold">Resumen</h2>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Subtotal</span>
                <span>{formatCents(order.subtotalInCents)}</span>
              </div>
              <div className="mt-1 flex justify-between text-sm">
                <span className="text-muted">Envío</span>
                <span>
                  {order.shippingInCents > 0
                    ? formatCents(order.shippingInCents)
                    : "Sin costo"}
                </span>
              </div>
              <div className="mt-3 flex justify-between border-t border-black/10 pt-3">
                <span className="font-display font-bold">Total</span>
                <span className="font-display text-deep text-xl font-bold">
                  {formatCents(order.totalInCents)}
                </span>
              </div>

              <div className="mt-4 border-t border-black/10 pt-4 text-sm">
                <p className="font-semibold">Entrega</p>
                {order.deliveryMethod === "SHIPPING" ? (
                  <p className="text-muted">
                    {order.shippingAddress}, {order.shippingCity} (
                    {order.shippingPostalCode})
                  </p>
                ) : (
                  <p className="text-muted">
                    Retiro en el taller · Paraguay 95
                  </p>
                )}
              </div>

              {isPaid ? (
                <div className="border-mint bg-mint/15 mt-4 border-l-4 p-4">
                  <p className="font-display text-deep font-black">
                    Comprobante de compra
                  </p>
                  <p className="text-muted mt-1 text-sm">
                    Pago confirmado por {formatCents(order.totalInCents)}.
                    {order.receiptEmailSentAt
                      ? ` Enviamos una copia a ${order.contactEmail}.`
                      : " El comprobante por email está siendo procesado."}
                  </p>
                  <PrintReceiptButton />
                  {order.payment ? (
                    <p className="text-muted mt-2 text-xs">
                      {order.payment.paymentMethodType === "credit_card"
                        ? "Tarjeta de crédito"
                        : order.payment.paymentMethodType === "debit_card"
                          ? "Tarjeta de débito"
                          : order.payment.channel.replaceAll("_", " ")}
                      {(order.payment.installments ?? 0) > 1
                        ? ` · ${order.payment.installments} cuotas`
                        : " · pago en 1 cuota"}
                    </p>
                  ) : null}
                  {vouchers.length ? (
                    <ul className="mt-3 flex flex-col gap-2">
                      {vouchers.map((voucher) => (
                        <li key={voucher.id}>
                          <a
                            href={voucher.downloadUrl ?? "#"}
                            target="_blank"
                            rel="noopener"
                            className="text-deep text-sm font-bold underline"
                          >
                            Descargar {voucher.label}{" "}
                            {String(voucher.pointOfSale ?? 0).padStart(5, "0")}-
                            {String(voucher.number ?? 0).padStart(8, "0")} (
                            {formatCents(voucher.amountInCents)})
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {order.status === "PENDING_PAYMENT" ? (
                <div className="mt-4 border-t border-black/10 pt-4">
                  <PaymentMethodPanel
                    orderId={order.id}
                    totalInCents={order.totalInCents}
                  />
                </div>
              ) : (
                <p className="text-muted mt-4 text-xs">
                  Te contactaremos a {order.contactEmail} ante cualquier
                  novedad.
                </p>
              )}
              <Link
                href={routes.catalog}
                className="border-deep/20 text-deep hover:border-blue hover:bg-paper mt-4 inline-flex min-h-10 w-full items-center justify-center rounded-lg border bg-white px-4 text-center text-sm font-bold transition-colors"
              >
                Seguir comprando
              </Link>
            </div>
          </div>
        </Container>
      </main>
    </div>
  );
}
