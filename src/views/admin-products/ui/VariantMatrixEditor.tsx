"use client";

import { useState } from "react";

import { colorToHex } from "elestampadero/shared/lib/color-swatch";

import {
  addColor,
  addSizes,
  effectiveColors,
  fillStock,
  findVariant,
  NO_COLOR,
  orderedVariants,
  removeColor,
  removeSize,
  setSaleMode,
  SIZE_PRESETS,
  stockErrorKey,
  toggleCombination,
  totalStock,
  updateVariant,
  type ProductDraft,
  type ProductDraftErrors,
} from "../model/product-draft";

const COLOR_SUGGESTIONS = [
  "Negro",
  "Blanco",
  "Gris",
  "Azul",
  "Azul marino",
  "Violeta",
  "Verde",
  "Rojo",
  "Naranja",
  "Amarillo",
  "Beige",
  "Bordo",
];

/**
 * Editor de variantes en tres pasos: modalidad de venta, talles y colores, y
 * una grilla con cada combinación. El stock solo se pide cuando la modalidad
 * es "con stock limitado", y en ese caso es obligatorio.
 */
export function VariantMatrixEditor({
  draft,
  errors,
  onChange,
}: {
  draft: ProductDraft;
  errors: ProductDraftErrors;
  onChange: (draft: ProductDraft) => void;
}) {
  const [newSize, setNewSize] = useState("");
  const [newColor, setNewColor] = useState("");
  const [bulkStock, setBulkStock] = useState("");
  const colors = effectiveColors(draft);
  const hasColors = draft.colors.length > 0;
  const variantCount = draft.variants.length;
  const stockTotal = totalStock(draft);

  function submitSize() {
    const sizes = newSize
      .split(/[,;]/)
      .map((size) => size.trim())
      .filter(Boolean);
    if (sizes.length === 0) return;
    onChange(addSizes(draft, sizes));
    setNewSize("");
  }

  function submitColor(color = newColor) {
    if (!color.trim()) return;
    onChange(addColor(draft, color));
    setNewColor("");
  }

  return (
    <div className="admin-variant-matrix">
      <fieldset className="admin-variant-step">
        <legend>
          <b>1</b> ¿Cómo se vende?
        </legend>
        <div className="admin-variant-sale-mode">
          <label className={!draft.showStock ? "is-selected" : undefined}>
            <input
              type="radio"
              name="product-sale-mode"
              checked={!draft.showStock}
              onChange={() => onChange(setSaleMode(draft, false))}
            />
            <strong>Por encargo</strong>
            <small>
              Se fabrica cuando entra el pedido. No hay que cargar stock y nunca
              se agota.
            </small>
          </label>
          <label className={draft.showStock ? "is-selected" : undefined}>
            <input
              type="radio"
              name="product-sale-mode"
              checked={draft.showStock}
              onChange={() => onChange(setSaleMode(draft, true))}
            />
            <strong>Con stock limitado</strong>
            <small>
              Cargás cuántas unidades hay de cada talle y color. Cada venta
              descuenta una y al llegar a 0 deja de venderse.
            </small>
          </label>
        </div>
      </fieldset>

      <fieldset className="admin-variant-step">
        <legend>
          <b>2</b> Talles
        </legend>
        <p className="admin-variant-step__help">
          Escribí uno o varios separados por coma, o usá una lista rápida.
        </p>
        <div className="admin-variant-chip-input">
          <input
            aria-label="Nuevo talle"
            placeholder="Ej.: S, M, L o 38"
            value={newSize}
            onChange={(event) => setNewSize(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitSize();
              }
            }}
          />
          <button
            type="button"
            className="admin-btn"
            onClick={submitSize}
            disabled={!newSize.trim()}
          >
            Agregar talle
          </button>
        </div>
        <div className="admin-variant-presets" aria-label="Listas rápidas">
          {SIZE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => onChange(addSizes(draft, preset.sizes))}
            >
              + {preset.label}
            </button>
          ))}
        </div>
        <ChipList
          items={draft.sizes}
          emptyLabel="Todavía no hay talles."
          removeLabel="Quitar talle"
          onRemove={(size) => onChange(removeSize(draft, size))}
        />
        {errors.sizes ? (
          <p className="admin-field-error" role="alert">
            {errors.sizes}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="admin-variant-step">
        <legend>
          <b>3</b> Colores <span>(opcional)</span>
        </legend>
        <p className="admin-variant-step__help">
          {hasColors
            ? "Cada color se combina con todos los talles."
            : "Sin colores, el comprador solo elige el talle. Agregá colores si la prenda se ofrece en más de uno."}
        </p>
        <div className="admin-variant-chip-input">
          <input
            aria-label="Nuevo color"
            placeholder="Ej.: Negro"
            list="admin-variant-color-suggestions"
            value={newColor}
            onChange={(event) => setNewColor(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitColor();
              }
            }}
          />
          <datalist id="admin-variant-color-suggestions">
            {COLOR_SUGGESTIONS.map((color) => (
              <option key={color} value={color} />
            ))}
          </datalist>
          <label
            className="admin-variant-color-custom"
            title="Elegir un color personalizado"
          >
            <input
              type="color"
              aria-label="Elegir un color personalizado"
              value="#7b2cbf"
              onChange={(event) => submitColor(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="admin-btn"
            onClick={() => submitColor()}
            disabled={!newColor.trim()}
          >
            Agregar color
          </button>
        </div>
        <div className="admin-variant-presets" aria-label="Colores frecuentes">
          {COLOR_SUGGESTIONS.filter(
            (color) =>
              !draft.colors.some(
                (existing) =>
                  existing.toLocaleLowerCase("es") ===
                  color.toLocaleLowerCase("es"),
              ),
          )
            .slice(0, 6)
            .map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => submitColor(color)}
              >
                <span
                  className="admin-variant-swatch"
                  style={{ backgroundColor: colorToHex(color) }}
                />
                {color}
              </button>
            ))}
        </div>
        <ChipList
          items={draft.colors}
          emptyLabel="Sin colores."
          removeLabel="Quitar color"
          renderPrefix={(color) =>
            color === NO_COLOR ? null : (
              <span
                className="admin-variant-swatch"
                style={{ backgroundColor: colorToHex(color) }}
              />
            )
          }
          onRemove={(color) => onChange(removeColor(draft, color))}
        />
      </fieldset>

      <fieldset className="admin-variant-step">
        <legend>
          <b>4</b> Combinaciones a la venta
        </legend>
        {draft.sizes.length === 0 ? (
          <p className="admin-variant-step__help">
            Agregá talles para ver las combinaciones.
          </p>
        ) : (
          <>
            <p className="admin-variant-step__help">
              {draft.showStock
                ? "Cargá las unidades disponibles de cada combinación (0 si no hay). Destildá las que no se fabrican."
                : "Destildá las combinaciones que no se ofrecen."}
            </p>
            {draft.showStock && variantCount > 1 ? (
              <div className="admin-variant-bulk-stock">
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  aria-label="Stock para todas las combinaciones"
                  placeholder="Ej.: 10"
                  value={bulkStock}
                  onChange={(event) => setBulkStock(event.target.value)}
                />
                <button
                  type="button"
                  className="admin-btn"
                  disabled={!bulkStock.trim()}
                  onClick={() => onChange(fillStock(draft, bulkStock.trim()))}
                >
                  Usar en todas
                </button>
              </div>
            ) : null}
            <div className="admin-variant-grid-wrap">
              <table className="admin-variant-grid">
                <thead>
                  <tr>
                    <th scope="col">Talle</th>
                    {colors.map((color) => (
                      <th key={color} scope="col">
                        {hasColors ? color : "Disponible"}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {draft.sizes.map((size) => (
                    <tr key={size}>
                      <th scope="row">{size}</th>
                      {colors.map((color) => {
                        const variant = findVariant(draft, size, color);
                        const cellError = errors[stockErrorKey(size, color)];
                        const label = hasColors ? `${size} ${color}` : size;
                        return (
                          <td
                            key={color}
                            className={!variant ? "is-off" : undefined}
                          >
                            <label className="admin-variant-grid__toggle">
                              <input
                                type="checkbox"
                                checked={Boolean(variant)}
                                aria-label={`Vender ${label}`}
                                onChange={() =>
                                  onChange(toggleCombination(draft, size, color))
                                }
                              />
                              {!draft.showStock ? (
                                <span>{variant ? "Sí" : "No"}</span>
                              ) : null}
                            </label>
                            {draft.showStock && variant ? (
                              <>
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  inputMode="numeric"
                                  required
                                  aria-label={`Stock ${label}`}
                                  aria-invalid={Boolean(cellError)}
                                  className="admin-variant-grid__stock"
                                  value={variant.stock}
                                  placeholder="Unid."
                                  onChange={(event) =>
                                    onChange(
                                      updateVariant(draft, size, color, {
                                        stock: event.target.value,
                                      }),
                                    )
                                  }
                                />
                                {cellError ? (
                                  <small className="admin-field-error">
                                    {cellError}
                                  </small>
                                ) : null}
                              </>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="admin-variant-summary">
              {variantCount} {variantCount === 1 ? "combinación" : "combinaciones"}{" "}
              a la venta
              {stockTotal !== null ? ` · ${stockTotal} unidades en stock` : ""}
            </p>
          </>
        )}
        {errors.variants ? (
          <p className="admin-field-error" role="alert">
            {errors.variants}
          </p>
        ) : null}
      </fieldset>

      {variantCount > 0 ? (
        <details className="admin-variant-skus">
          <summary>Códigos de variante (opcional)</summary>
          <p className="admin-variant-step__help">
            Si los dejás vacíos se generan solos a partir del código del
            producto.
          </p>
          <div className="admin-variant-skus__list">
            {orderedVariants(draft).map((variant) => (
              <label key={`${variant.size}-${variant.color}`}>
                <span>
                  {variant.size}
                  {hasColors ? ` · ${variant.color}` : ""}
                </span>
                <input
                  value={variant.sku}
                  placeholder="Automático"
                  onChange={(event) =>
                    onChange(
                      updateVariant(draft, variant.size, variant.color, {
                        sku: event.target.value,
                      }),
                    )
                  }
                />
              </label>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ChipList({
  items,
  emptyLabel,
  removeLabel,
  renderPrefix,
  onRemove,
}: {
  items: string[];
  emptyLabel: string;
  removeLabel: string;
  renderPrefix?: (item: string) => React.ReactNode;
  onRemove: (item: string) => void;
}) {
  return (
    <div className="admin-variant-chips">
      {items.length ? (
        items.map((item) => (
          <span key={item}>
            {renderPrefix?.(item)}
            {item}
            <button
              type="button"
              aria-label={`${removeLabel} ${item}`}
              onClick={() => onRemove(item)}
            >
              ×
            </button>
          </span>
        ))
      ) : (
        <small>{emptyLabel}</small>
      )}
    </div>
  );
}
