"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { cartSubtotalCents, useCartStore } from "elestampadero/entities/cart";
import { routes } from "elestampadero/shared/config/routes";
import { formatCents } from "elestampadero/shared/lib/money";
import { isValidCuit } from "elestampadero/shared/lib/cuit";
import { BackLink, Button, Container } from "elestampadero/shared/ui";
import { StoreHeader } from "elestampadero/widgets/store-header";
import { api } from "elestampadero/trpc/react";

const FLAT_SHIPPING_IN_CENTS = 620_000;
const CHECKOUT_INPUT_CLASSES =
  "w-full rounded-lg border border-black/10 bg-white px-4 py-3 text-base outline-none transition-colors hover:border-blue focus:border-blue focus-visible:border-blue focus-visible:outline-none";
const INVALID_INPUT_CLASSES =
  "border-red-500 hover:border-red-500 focus:border-red-500 focus-visible:border-red-500";
const CHECKOUT_REQUEST_STORAGE_KEY = "checkout-request-id";

type CheckoutField =
  | "contactName"
  | "customerDocument"
  | "contactEmail"
  | "contactPhone"
  | "shippingAddress"
  | "shippingCity"
  | "shippingPostalCode"
  | "customerTaxId"
  | "customerLegalName"
  | "customerTaxCondition";

type CheckoutFieldErrors = Partial<Record<CheckoutField, string>>;

const CHECKOUT_FIELDS: CheckoutField[] = [
  "contactName",
  "customerDocument",
  "customerTaxId",
  "customerLegalName",
  "customerTaxCondition",
  "contactEmail",
  "contactPhone",
  "shippingAddress",
  "shippingCity",
  "shippingPostalCode",
];

export function CheckoutView() {
  const router = useRouter();
  const checkoutRequestId = useRef<string | null>(null);
  const lines = useCartStore((state) => state.lines);
  const subtotal = cartSubtotalCents(lines);

  const [contactName, setContactName] = useState("");
  const [customerDocument, setCustomerDocument] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [requiresInvoiceA, setRequiresInvoiceA] = useState(false);
  const [customerTaxId, setCustomerTaxId] = useState("");
  const [customerLegalName, setCustomerLegalName] = useState("");
  const [customerTaxCondition, setCustomerTaxCondition] = useState<
    "" | "RESPONSABLE_INSCRIPTO" | "MONOTRIBUTO" | "EXENTO"
  >("");
  const [deliveryMethod, setDeliveryMethod] = useState<"SHIPPING" | "PICKUP">(
    "SHIPPING",
  );
  const [shippingAddress, setShippingAddress] = useState("");
  const [shippingCity, setShippingCity] = useState("");
  const [shippingPostalCode, setShippingPostalCode] = useState("");
  const [fieldErrors, setFieldErrors] = useState<CheckoutFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const shipping = deliveryMethod === "SHIPPING" ? FLAT_SHIPPING_IN_CENTS : 0;
  const total = subtotal + shipping;

  const submitCheckout = api.checkout.submit.useMutation({
    onSuccess: (order) => {
      window.sessionStorage.removeItem(CHECKOUT_REQUEST_STORAGE_KEY);
      router.push(`/pedido/${order.id}`);
    },
    onError: (error) => {
      const serverErrors = error.data?.zodError;
      if (serverErrors) {
        const nextFieldErrors: CheckoutFieldErrors = {};
        for (const field of CHECKOUT_FIELDS) {
          const message = serverErrors.fieldErrors[field]?.[0];
          if (message) nextFieldErrors[field] = message;
        }
        setFieldErrors(nextFieldErrors);
        setFormError(
          serverErrors.formErrors[0] ??
            (Object.keys(nextFieldErrors).length === 0
              ? "Revisá los datos ingresados e intentá nuevamente."
              : null),
        );
        return;
      }
      setFormError(error.message);
    },
  });

  function clearFieldError(field: CheckoutField) {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function validateFields(): CheckoutFieldErrors {
    const errors: CheckoutFieldErrors = {};

    if (contactName.trim().length < 2) {
      errors.contactName = "El nombre debe tener al menos 2 caracteres.";
    }
    if (!/^\d{7,11}$/.test(customerDocument.trim())) {
      errors.customerDocument = "El DNI debe tener entre 7 y 11 números.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) {
      errors.contactEmail = "Ingresá un correo electrónico válido.";
    }
    if (!/^\d{6,15}$/.test(contactPhone.trim())) {
      errors.contactPhone = "El teléfono debe tener entre 6 y 15 números.";
    }

    if (requiresInvoiceA) {
      if (!isValidCuit(customerTaxId)) {
        errors.customerTaxId = "Ingresá un CUIT válido de 11 números.";
      }
      if (customerLegalName.trim().length < 2) {
        errors.customerLegalName = "Ingresá la razón social.";
      }
      if (!customerTaxCondition) {
        errors.customerTaxCondition = "Elegí la condición frente al IVA.";
      }
    }

    if (deliveryMethod === "SHIPPING") {
      if (shippingAddress.trim().length < 5) {
        errors.shippingAddress =
          "La dirección debe tener al menos 5 caracteres.";
      }
      if (shippingCity.trim().length < 2) {
        errors.shippingCity = "La ciudad debe tener al menos 2 caracteres.";
      }
      if (shippingPostalCode.trim().length < 2) {
        errors.shippingPostalCode =
          "El código postal debe tener al menos 2 caracteres.";
      }
    }

    return errors;
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    const nextFieldErrors = validateFields();
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) return;

    checkoutRequestId.current ??=
      window.sessionStorage.getItem(CHECKOUT_REQUEST_STORAGE_KEY) ??
      crypto.randomUUID();
    window.sessionStorage.setItem(
      CHECKOUT_REQUEST_STORAGE_KEY,
      checkoutRequestId.current,
    );
    submitCheckout.mutate({
      checkoutRequestId: checkoutRequestId.current,
      contactName,
      customerDocument,
      contactEmail,
      contactPhone,
      ...(requiresInvoiceA
        ? {
            requiresInvoiceA: true,
            customerTaxId,
            customerLegalName,
            customerTaxCondition: customerTaxCondition || undefined,
          }
        : { requiresInvoiceA: false }),
      deliveryMethod,
      shippingAddress:
        deliveryMethod === "SHIPPING" ? shippingAddress : undefined,
      shippingCity: deliveryMethod === "SHIPPING" ? shippingCity : undefined,
      shippingPostalCode:
        deliveryMethod === "SHIPPING" ? shippingPostalCode : undefined,
      lines: lines.map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
      })),
    });
  }

  if (lines.length === 0) {
    return (
      <div className="bg-paper flex min-h-screen flex-col">
        <StoreHeader />
        <main className="flex-1">
          <Container className="py-16 text-center">
            <p className="text-muted mb-4">Tu carrito está vacío.</p>
            <a
              href={routes.catalog}
              className="text-deep font-semibold hover:underline"
            >
              Ver catálogo
            </a>
          </Container>
        </main>
      </div>
    );
  }

  return (
    <div className="bg-paper flex min-h-screen flex-col">
      <StoreHeader />
      <main className="flex-1">
        <Container className="py-6 md:py-10">
          <div className="mb-5 flex flex-col items-start gap-3 md:mb-6">
            <BackLink fallback={routes.cart} className="catalog-back-link" />
            <h1 className="font-display text-ink text-[26px] font-black md:text-2xl">
              Finalizar compra
            </h1>
          </div>

          <form
            onSubmit={handleSubmit}
            noValidate
            className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]"
          >
            <div className="flex flex-col gap-6">
              <fieldset className="rounded-lg bg-white p-4 md:p-5">
                <legend className="font-display mb-3 font-bold">
                  Datos de contacto
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <input
                      required
                      aria-invalid={Boolean(fieldErrors.contactName)}
                      aria-describedby={
                        fieldErrors.contactName
                          ? "contact-name-error"
                          : undefined
                      }
                      placeholder="Nombre y apellido"
                      value={contactName}
                      onChange={(event) => {
                        setContactName(event.target.value);
                        clearFieldError("contactName");
                      }}
                      className={`${CHECKOUT_INPUT_CLASSES} ${fieldErrors.contactName ? INVALID_INPUT_CLASSES : ""}`}
                    />
                    {fieldErrors.contactName ? (
                      <p
                        id="contact-name-error"
                        className="mt-1 text-xs font-medium text-red-600"
                      >
                        {fieldErrors.contactName}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <input
                      required
                      inputMode="numeric"
                      autoComplete="off"
                      aria-invalid={Boolean(fieldErrors.customerDocument)}
                      aria-describedby={
                        fieldErrors.customerDocument
                          ? "customer-document-error"
                          : undefined
                      }
                      placeholder="DNI"
                      value={customerDocument}
                      onChange={(event) => {
                        setCustomerDocument(event.target.value);
                        clearFieldError("customerDocument");
                      }}
                      className={`${CHECKOUT_INPUT_CLASSES} ${fieldErrors.customerDocument ? INVALID_INPUT_CLASSES : ""}`}
                    />
                    {fieldErrors.customerDocument ? (
                      <p
                        id="customer-document-error"
                        className="mt-1 text-xs font-medium text-red-600"
                      >
                        {fieldErrors.customerDocument}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <input
                      required
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      aria-invalid={Boolean(fieldErrors.contactEmail)}
                      aria-describedby={
                        fieldErrors.contactEmail
                          ? "contact-email-error"
                          : undefined
                      }
                      placeholder="Email"
                      value={contactEmail}
                      onChange={(event) => {
                        setContactEmail(event.target.value.replace(/\s/g, ""));
                        clearFieldError("contactEmail");
                      }}
                      className={`${CHECKOUT_INPUT_CLASSES} ${fieldErrors.contactEmail ? INVALID_INPUT_CLASSES : ""}`}
                    />
                    {fieldErrors.contactEmail ? (
                      <p
                        id="contact-email-error"
                        className="mt-1 text-xs font-medium text-red-600"
                      >
                        {fieldErrors.contactEmail}
                      </p>
                    ) : null}
                  </div>
                  <div className="sm:col-span-2">
                    <input
                      required
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      maxLength={15}
                      aria-invalid={Boolean(fieldErrors.contactPhone)}
                      aria-describedby={
                        fieldErrors.contactPhone
                          ? "contact-phone-error"
                          : undefined
                      }
                      placeholder="Teléfono"
                      value={contactPhone}
                      onChange={(event) => {
                        setContactPhone(event.target.value.replace(/\D/g, ""));
                        clearFieldError("contactPhone");
                      }}
                      className={`${CHECKOUT_INPUT_CLASSES} ${fieldErrors.contactPhone ? INVALID_INPUT_CLASSES : ""}`}
                    />
                    {fieldErrors.contactPhone ? (
                      <p
                        id="contact-phone-error"
                        className="mt-1 text-xs font-medium text-red-600"
                      >
                        {fieldErrors.contactPhone}
                      </p>
                    ) : null}
                  </div>
                </div>
                <label className="mt-4 flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={requiresInvoiceA}
                    onChange={(event) => setRequiresInvoiceA(event.target.checked)}
                    className="h-4 w-4"
                  />
                  Necesito factura A (con CUIT)
                </label>
                {requiresInvoiceA ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <input
                        inputMode="numeric"
                        maxLength={13}
                        aria-invalid={Boolean(fieldErrors.customerTaxId)}
                        placeholder="CUIT (11 números)"
                        value={customerTaxId}
                        onChange={(event) => {
                          setCustomerTaxId(event.target.value.replace(/[^\d-]/g, ""));
                          clearFieldError("customerTaxId");
                        }}
                        className={`${CHECKOUT_INPUT_CLASSES} ${fieldErrors.customerTaxId ? INVALID_INPUT_CLASSES : ""}`}
                      />
                      {fieldErrors.customerTaxId ? (
                        <p className="mt-1 text-xs font-medium text-red-600">
                          {fieldErrors.customerTaxId}
                        </p>
                      ) : null}
                    </div>
                    <div>
                      <select
                        aria-label="Condición frente al IVA"
                        aria-invalid={Boolean(fieldErrors.customerTaxCondition)}
                        value={customerTaxCondition}
                        onChange={(event) => {
                          setCustomerTaxCondition(
                            event.target.value as typeof customerTaxCondition,
                          );
                          clearFieldError("customerTaxCondition");
                        }}
                        className={`${CHECKOUT_INPUT_CLASSES} ${fieldErrors.customerTaxCondition ? INVALID_INPUT_CLASSES : ""}`}
                      >
                        <option value="">Condición frente al IVA</option>
                        <option value="RESPONSABLE_INSCRIPTO">
                          Responsable inscripto
                        </option>
                        <option value="MONOTRIBUTO">Monotributo</option>
                        <option value="EXENTO">Exento</option>
                      </select>
                      {fieldErrors.customerTaxCondition ? (
                        <p className="mt-1 text-xs font-medium text-red-600">
                          {fieldErrors.customerTaxCondition}
                        </p>
                      ) : null}
                    </div>
                    <div className="sm:col-span-2">
                      <input
                        aria-invalid={Boolean(fieldErrors.customerLegalName)}
                        placeholder="Razón social"
                        value={customerLegalName}
                        onChange={(event) => {
                          setCustomerLegalName(event.target.value);
                          clearFieldError("customerLegalName");
                        }}
                        className={`${CHECKOUT_INPUT_CLASSES} ${fieldErrors.customerLegalName ? INVALID_INPUT_CLASSES : ""}`}
                      />
                      {fieldErrors.customerLegalName ? (
                        <p className="mt-1 text-xs font-medium text-red-600">
                          {fieldErrors.customerLegalName}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </fieldset>

              <fieldset className="rounded-lg bg-white p-4 md:p-5">
                <legend className="font-display mb-3 font-bold">Entrega</legend>
                <div className="mb-3 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setDeliveryMethod("SHIPPING")}
                    className={`rounded border p-3 text-left ${
                      deliveryMethod === "SHIPPING"
                        ? "border-deep bg-deep/5"
                        : "border-black/10"
                    }`}
                  >
                    <span className="block font-semibold">
                      Envío a domicilio
                    </span>
                    <span className="text-muted text-xs">
                      Correo Argentino · 3 a 5 días
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeliveryMethod("PICKUP")}
                    className={`rounded border p-3 text-left ${
                      deliveryMethod === "PICKUP"
                        ? "border-deep bg-deep/5"
                        : "border-black/10"
                    }`}
                  >
                    <span className="block font-semibold">
                      Retiro en el taller
                    </span>
                    <span className="text-muted text-xs">
                      Sin costo · Lun a Vie
                    </span>
                  </button>
                </div>

                {deliveryMethod === "SHIPPING" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <input
                        required
                        aria-invalid={Boolean(fieldErrors.shippingAddress)}
                        aria-describedby={
                          fieldErrors.shippingAddress
                            ? "shipping-address-error"
                            : undefined
                        }
                        placeholder="Dirección"
                        value={shippingAddress}
                        onChange={(event) => {
                          setShippingAddress(event.target.value);
                          clearFieldError("shippingAddress");
                        }}
                        className={`${CHECKOUT_INPUT_CLASSES} ${fieldErrors.shippingAddress ? INVALID_INPUT_CLASSES : ""}`}
                      />
                      {fieldErrors.shippingAddress ? (
                        <p
                          id="shipping-address-error"
                          className="mt-1 text-xs font-medium text-red-600"
                        >
                          {fieldErrors.shippingAddress}
                        </p>
                      ) : null}
                    </div>
                    <div>
                      <input
                        required
                        aria-invalid={Boolean(fieldErrors.shippingCity)}
                        aria-describedby={
                          fieldErrors.shippingCity
                            ? "shipping-city-error"
                            : undefined
                        }
                        placeholder="Ciudad"
                        value={shippingCity}
                        onChange={(event) => {
                          setShippingCity(event.target.value);
                          clearFieldError("shippingCity");
                        }}
                        className={`${CHECKOUT_INPUT_CLASSES} ${fieldErrors.shippingCity ? INVALID_INPUT_CLASSES : ""}`}
                      />
                      {fieldErrors.shippingCity ? (
                        <p
                          id="shipping-city-error"
                          className="mt-1 text-xs font-medium text-red-600"
                        >
                          {fieldErrors.shippingCity}
                        </p>
                      ) : null}
                    </div>
                    <div>
                      <input
                        required
                        aria-invalid={Boolean(fieldErrors.shippingPostalCode)}
                        aria-describedby={
                          fieldErrors.shippingPostalCode
                            ? "shipping-postal-code-error"
                            : undefined
                        }
                        placeholder="Código postal"
                        value={shippingPostalCode}
                        onChange={(event) => {
                          setShippingPostalCode(event.target.value);
                          clearFieldError("shippingPostalCode");
                        }}
                        className={`${CHECKOUT_INPUT_CLASSES} ${fieldErrors.shippingPostalCode ? INVALID_INPUT_CLASSES : ""}`}
                      />
                      {fieldErrors.shippingPostalCode ? (
                        <p
                          id="shipping-postal-code-error"
                          className="mt-1 text-xs font-medium text-red-600"
                        >
                          {fieldErrors.shippingPostalCode}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </fieldset>

              {formError ? (
                <p className="text-sm font-semibold text-red-600">
                  {formError}
                </p>
              ) : null}
            </div>

            <div className="h-fit rounded-lg bg-white p-4 md:p-5">
              <h2 className="font-display mb-4 text-lg font-bold">Tu pedido</h2>
              <ul className="mb-4 flex flex-col gap-2 text-sm">
                {lines.map((line) => (
                  <li key={line.variantId} className="flex justify-between">
                    <span className="text-muted">
                      {line.quantity} × {line.productName}
                    </span>
                    <span className="font-semibold">
                      {formatCents(line.priceInCents * line.quantity)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between border-t border-black/10 pt-3 text-sm">
                <span className="text-muted">Envío</span>
                <span className="font-semibold">
                  {shipping > 0 ? formatCents(shipping) : "Sin costo"}
                </span>
              </div>
              <div className="mt-3 flex justify-between border-t border-black/10 pt-3">
                <span className="font-display font-bold">Total</span>
                <span className="font-display text-deep text-xl font-bold">
                  {formatCents(total)}
                </span>
              </div>
              <Button
                type="submit"
                className="mt-4 w-full"
                disabled={submitCheckout.isPending}
                loading={submitCheckout.isPending}
                loadingLabel="Confirmando pedido"
              >
                {submitCheckout.isPending
                  ? "Procesando..."
                  : "Confirmar pedido"}
              </Button>
              <p className="text-muted mt-2 text-xs">
                Al confirmar, Mobbex te permite elegir tarjeta, cuotas o QR
                interoperable para pagar desde Mercado Pago, MODO u otra app
                bancaria compatible.
              </p>
            </div>
          </form>
        </Container>
      </main>
    </div>
  );
}
