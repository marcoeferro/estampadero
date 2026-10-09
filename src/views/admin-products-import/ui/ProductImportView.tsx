"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { ModernSpinner } from "elestampadero/shared/ui/motion";

import "./product-import.css";

type RowIssue = { rowNumber: number; code: string | null; message: string };
type Preview = {
  totalRows: number;
  products: {
    code: string;
    name: string | null;
    action: "create" | "update";
    variants: number;
    rows: number;
    showStock: boolean;
    status: "DRAFT" | "PUBLISHED" | null;
  }[];
  errors: RowIssue[];
};
type ReportRow = {
  rowNumber: number;
  code: string | null;
  result: "Creado" | "Actualizado" | "Error";
  message: string;
};
type ApplyResult = {
  totalRows: number;
  created: number;
  updated: number;
  errorRows: number;
  rows: ReportRow[];
  reportBase64: string;
};

async function send<T>(file: File, mode: "preview" | "apply"): Promise<T> {
  const body = new FormData();
  body.set("file", file);
  body.set("mode", mode);
  const response = await fetch("/api/admin/productos/importar", {
    method: "POST",
    body,
  });
  const data = (await response.json().catch(() => null)) as
    (T & { error?: string }) | null;
  if (!response.ok || !data) {
    throw new Error(data?.error ?? "No se pudo procesar la planilla.");
  }
  return data;
}

function downloadBase64(base64: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(
    new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Carga masiva en tres pasos: descargar la planilla modelo, subirla para ver
 * una vista previa y confirmar. Al final se puede descargar el informe.
 */
export function ProductImportView() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);

  async function choose(selected: File | null) {
    setFile(selected);
    setPreview(null);
    setResult(null);
    setError(null);
    if (!selected) return;
    setBusy("preview");
    try {
      setPreview(await send<Preview>(selected, "preview"));
    } catch (sendError) {
      setError((sendError as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!file) return;
    setBusy("apply");
    setError(null);
    try {
      setResult(await send<ApplyResult>(file, "apply"));
      setPreview(null);
    } catch (sendError) {
      setError((sendError as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const toCreate = preview?.products.filter((p) => p.action === "create") ?? [];
  const toUpdate = preview?.products.filter((p) => p.action === "update") ?? [];

  return (
    <div className="admin-import">
      <ol className="admin-import__steps">
        <li>
          <strong>1. Descargá la planilla modelo</strong>
          <p>
            Tiene las columnas armadas, un producto de ejemplo y una hoja de
            instrucciones. Usá una fila por cada talle y color; las filas con el
            mismo código forman un producto.
          </p>
          <a
            className="admin-btn"
            href="/api/admin/productos/plantilla"
            download
          >
            Descargar planilla modelo
          </a>
        </li>
        <li>
          <strong>2. Subí la planilla completa</strong>
          <p>
            Archivo .xlsx de hasta 1.000 filas. Antes de guardar vas a ver qué
            se crea, qué se actualiza y qué filas tienen errores.
          </p>
          <label className="admin-import__file">
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => void choose(event.target.files?.[0] ?? null)}
            />
            <span>{file ? file.name : "Elegir archivo…"}</span>
          </label>
        </li>
        <li>
          <strong>3. Revisá y confirmá</strong>
          <p>
            Los productos nuevos quedan No publicados salvo que la planilla diga
            Publicado. Las imágenes se agregan después desde cada producto.
          </p>
        </li>
      </ol>

      {busy === "preview" ? (
        <p className="admin-import__status">
          <ModernSpinner label="Leyendo planilla" /> Leyendo la planilla…
        </p>
      ) : null}
      {error ? (
        <p className="admin-product-modal__error" role="alert">
          {error}
        </p>
      ) : null}

      {preview ? (
        <section className="admin-import__preview" aria-label="Vista previa">
          <div className="admin-import__summary">
            <div>
              <b>{preview.totalRows}</b>
              <span>filas leídas</span>
            </div>
            <div>
              <b>{toCreate.length}</b>
              <span>productos nuevos</span>
            </div>
            <div>
              <b>{toUpdate.length}</b>
              <span>productos a actualizar</span>
            </div>
            <div className={preview.errors.length ? "is-error" : undefined}>
              <b>{preview.errors.length}</b>
              <span>filas con error</span>
            </div>
          </div>

          {preview.errors.length ? (
            <>
              <h3>Filas con error (no se van a cargar)</h3>
              <IssueTable rows={preview.errors} />
            </>
          ) : null}

          {preview.products.length ? (
            <>
              <h3>Productos que se van a cargar</h3>
              <div className="admin-table-wrap">
                <table className="admin-table admin-import__table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Nombre</th>
                      <th>Acción</th>
                      <th>Variantes</th>
                      <th>Venta</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.products.map((product) => (
                      <tr key={product.code}>
                        <td>{product.code}</td>
                        <td>{product.name ?? "(sin cambios)"}</td>
                        <td>
                          <span
                            className={`admin-chip ${
                              product.action === "create"
                                ? "admin-chip--success"
                                : "admin-chip--warning"
                            }`}
                          >
                            {product.action === "create"
                              ? "Crear"
                              : "Actualizar"}
                          </span>
                        </td>
                        <td>{product.variants}</td>
                        <td>
                          {product.showStock ? "Con stock" : "Por encargo"}
                        </td>
                        <td>
                          {product.status === "PUBLISHED"
                            ? "Publicado"
                            : product.status === "DRAFT"
                              ? "No publicado"
                              : "(sin cambios)"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          <div className="admin-import__actions">
            <button type="button" className="admin-btn" onClick={reset}>
              Elegir otro archivo
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              disabled={!preview.products.length || busy !== null}
              onClick={() => void apply()}
            >
              {busy === "apply" ? (
                <>
                  <ModernSpinner label="Cargando" /> Cargando…
                </>
              ) : (
                `Confirmar carga de ${preview.products.length} producto${
                  preview.products.length === 1 ? "" : "s"
                }`
              )}
            </button>
          </div>
        </section>
      ) : null}

      {result ? (
        <section className="admin-import__preview" aria-label="Resultado">
          <div className="admin-import__summary">
            <div>
              <b>{result.created}</b>
              <span>productos creados</span>
            </div>
            <div>
              <b>{result.updated}</b>
              <span>productos actualizados</span>
            </div>
            <div className={result.errorRows ? "is-error" : undefined}>
              <b>{result.errorRows}</b>
              <span>filas con error</span>
            </div>
          </div>
          {result.errorRows ? (
            <IssueTable
              rows={result.rows.filter((row) => row.result === "Error")}
            />
          ) : null}
          <div className="admin-import__actions">
            <button
              type="button"
              className="admin-btn"
              onClick={() =>
                downloadBase64(
                  result.reportBase64,
                  "resultado-carga-productos.xlsx",
                )
              }
            >
              Descargar informe
            </button>
            <button type="button" className="admin-btn" onClick={reset}>
              Cargar otra planilla
            </button>
            <Link
              className="admin-btn admin-btn--primary"
              href="/admin/productos"
            >
              Ver productos
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function IssueTable({ rows }: { rows: RowIssue[] }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table admin-import__table">
        <thead>
          <tr>
            <th>Fila</th>
            <th>Código</th>
            <th>Motivo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.rowNumber}-${index}`}>
              <td>{row.rowNumber || "—"}</td>
              <td>{row.code ?? "—"}</td>
              <td>{row.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
