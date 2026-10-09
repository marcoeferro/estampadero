"use client";

import { useState } from "react";

import { api, type RouterOutputs } from "elestampadero/trpc/react";

type Product = RouterOutputs["catalog"]["adminList"][number];

/**
 * Edición de precio, visibilidad y stock desde el listado, sin abrir el
 * formulario completo del producto.
 */
export function ProductQuickEdit({
  product,
  onDone,
}: {
  product: Product;
  onDone: () => void;
}) {
  const utils = api.useUtils();
  const [price, setPrice] = useState(String(product.priceInCents / 100));
  const [published, setPublished] = useState(product.status === "PUBLISHED");
  const [stocks, setStocks] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      product.variants.map((variant) => [
        variant.id,
        variant.stock === null ? "" : String(variant.stock),
      ]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const quickUpdate = api.catalog.adminQuickUpdate.useMutation({
    onSuccess: async () => {
      await utils.catalog.adminList.invalidate();
      onDone();
    },
    onError: (mutationError) => setError(mutationError.message),
  });

  function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const priceValue = Number(price);
    if (!price.trim() || !Number.isFinite(priceValue) || priceValue < 0) {
      setError("Ingresá un precio válido.");
      return;
    }
    const variantStocks: { id: string; stock: number }[] = [];
    if (product.showStock) {
      for (const variant of product.variants) {
        const raw = stocks[variant.id] ?? "";
        const value = Number(raw);
        if (!raw.trim() || !Number.isInteger(value) || value < 0) {
          setError(
            `Cargá un stock válido para ${variant.size} ${variant.color === "Sin definir" ? "" : variant.color}`.trim() +
              " (número entero, 0 o más).",
          );
          return;
        }
        variantStocks.push({ id: variant.id, stock: value });
      }
    }
    quickUpdate.mutate({
      id: product.id,
      priceInCents: Math.round(priceValue * 100),
      status: published ? "PUBLISHED" : "DRAFT",
      ...(variantStocks.length ? { variantStocks } : {}),
    });
  }

  const hasColors = product.variants.some(
    (variant) => variant.color !== "Sin definir",
  );

  return (
    <form className="admin-product-quick-edit" onSubmit={save} noValidate>
      <label>
        <span>Precio ($)</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
      </label>
      <label className="admin-product-quick-edit__toggle">
        <input
          type="checkbox"
          checked={published}
          onChange={(event) => setPublished(event.target.checked)}
        />
        <span>Publicado en la tienda</span>
      </label>
      {product.showStock ? (
        <div className="admin-product-quick-edit__stocks">
          <span>Stock por variante</span>
          <div>
            {product.variants.map((variant) => (
              <label key={variant.id}>
                <small>
                  {variant.size}
                  {hasColors ? ` · ${variant.color}` : ""}
                </small>
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={stocks[variant.id] ?? ""}
                  onChange={(event) =>
                    setStocks((current) => ({
                      ...current,
                      [variant.id]: event.target.value,
                    }))
                  }
                />
              </label>
            ))}
          </div>
        </div>
      ) : (
        <p className="admin-product-quick-edit__note">
          Por encargo: no lleva stock.
        </p>
      )}
      {error ? <p className="admin-field-error">{error}</p> : null}
      <div className="admin-product-quick-edit__actions">
        <button type="button" className="admin-btn" onClick={onDone}>
          Cancelar
        </button>
        <button
          type="submit"
          className="admin-btn admin-btn--primary"
          disabled={quickUpdate.isPending}
        >
          {quickUpdate.isPending ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </form>
  );
}
