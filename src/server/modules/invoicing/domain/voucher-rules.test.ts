import { describe, expect, it } from "vitest";

import { isValidCuit } from "elestampadero/shared/lib/cuit";

import {
  buyerForOrder,
  pendingCreditAmount,
  retryDelayMs,
  scaleLines,
  splitVat,
  voucherLetter,
  voucherTypeLabel,
} from "./voucher-rules";

describe("reglas de comprobantes", () => {
  it("elige la letra según emisor y comprador", () => {
    expect(voucherLetter("MONOTRIBUTO", "RESPONSABLE_INSCRIPTO")).toBe("C");
    expect(
      voucherLetter("RESPONSABLE_INSCRIPTO", "RESPONSABLE_INSCRIPTO"),
    ).toBe("A");
    expect(voucherLetter("RESPONSABLE_INSCRIPTO", "MONOTRIBUTO")).toBe("A");
    expect(voucherLetter("RESPONSABLE_INSCRIPTO", "CONSUMIDOR_FINAL")).toBe(
      "B",
    );
    expect(voucherLetter("RESPONSABLE_INSCRIPTO", "EXENTO")).toBe("B");
  });

  it("discrimina IVA solo en A y B", () => {
    expect(splitVat(12_100, "B", 21)).toEqual({
      netAmountInCents: 10_000,
      vatAmountInCents: 2_100,
    });
    expect(splitVat(12_100, "C", 21)).toEqual({
      netAmountInCents: 12_100,
      vatAmountInCents: 0,
    });
  });

  it("factura a consumidor final con DNI o con CUIT si lo informó", () => {
    const order = {
      contactName: "Ana",
      customerDocument: "30111222",
      customerTaxId: null,
      customerLegalName: null,
      customerTaxCondition: null,
    };
    expect(buyerForOrder(order as Parameters<typeof buyerForOrder>[0])).toEqual(
      {
        docType: "DNI",
        docNumber: "30111222",
        name: "Ana",
        taxCondition: "CONSUMIDOR_FINAL",
      },
    );
    expect(
      buyerForOrder({
        ...order,
        customerTaxId: "20301112223",
        customerLegalName: "Ana SRL",
        customerTaxCondition: "MONOTRIBUTO",
      } as Parameters<typeof buyerForOrder>[0]),
    ).toMatchObject({
      docType: "CUIT",
      name: "Ana SRL",
      taxCondition: "MONOTRIBUTO",
    });
  });

  it("calcula la nota de crédito proporcional a lo facturado", () => {
    expect(
      pendingCreditAmount({
        refundedInCents: 1_000,
        orderTotalInCents: 4_000,
        invoicedInCents: 2_000,
        alreadyCreditedInCents: 0,
      }),
    ).toBe(500);
    expect(
      pendingCreditAmount({
        refundedInCents: 4_000,
        orderTotalInCents: 4_000,
        invoicedInCents: 2_000,
        alreadyCreditedInCents: 500,
      }),
    ).toBe(1_500);
  });

  it("reparte una nota parcial entre las líneas sin perder centavos", () => {
    const lines = scaleLines(
      [
        { description: "A", quantity: 1, totalInCents: 1_000 },
        { description: "B", quantity: 1, totalInCents: 2_000 },
      ],
      1_001,
    );
    expect(lines.map((line) => line.totalInCents)).toEqual([334, 667]);
  });

  it("espera cada vez más entre reintentos y corta al final", () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(10)).toBe(24 * 60 * 60_000);
    expect(retryDelayMs(11)).toBeNull();
  });

  it("muestra el tipo de comprobante legible", () => {
    expect(voucherTypeLabel("FACTURA_B")).toBe("Factura B");
    expect(voucherTypeLabel("NOTA_CREDITO_C")).toBe("Nota de crédito C");
  });

  it("valida el dígito verificador del CUIT", () => {
    expect(isValidCuit("20-30111222-1")).toBe(false);
    expect(isValidCuit("30712345675")).toBe(false);
    expect(isValidCuit("20111111112")).toBe(true);
    expect(isValidCuit("27-12345678-0")).toBe(true);
    expect(isValidCuit("123")).toBe(false);
  });
});
