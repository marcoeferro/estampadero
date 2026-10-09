import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OrderForInvoicing } from "../domain/voucher-rules";
import { createInvoicingService } from "./invoicing-service";
import {
  TransientInvoicingError,
  type InvoicingProvider,
  type VoucherRequest,
  type VoucherResult,
} from "./ports/invoicing-provider";
import type {
  InvoicingRepository,
  VoucherRecord,
} from "./ports/invoicing-repository";

function memoryRepository(
  orders: Map<string, OrderForInvoicing & { isPaid: boolean }>,
) {
  const vouchers = new Map<string, VoucherRecord>();
  let sequence = 0;
  const repository: InvoicingRepository = {
    getOrder: async (id) => orders.get(id) ?? null,
    listVouchersForOrder: async (orderId) =>
      [...vouchers.values()].filter((voucher) => voucher.orderId === orderId),
    findVoucher: async (id) => vouchers.get(id) ?? null,
    findByProviderVoucherId: async (providerId) =>
      [...vouchers.values()].find((v) => v.providerVoucherId === providerId) ??
      null,
    createVoucherOnce: async (data) => {
      const existing = [...vouchers.values()].find(
        (voucher) => voucher.idempotencyKey === data.idempotencyKey,
      );
      if (existing) return existing;
      const voucher: VoucherRecord = {
        ...data,
        id: `v${++sequence}`,
        status: "PENDING",
        providerVoucherId: null,
        pointOfSale: null,
        number: null,
        cae: null,
        caeExpiresAt: null,
        pdfUrl: null,
        issuedAt: null,
        emailSentAt: null,
        attempts: 0,
        nextAttemptAt: new Date(0),
        errorMessage: null,
        createdAt: new Date(),
      };
      vouchers.set(voucher.id, voucher);
      return voucher;
    },
    claimVoucher: async (id, now) => {
      const voucher = vouchers.get(id);
      if (voucher?.status !== "PENDING" || voucher.nextAttemptAt > now) {
        return null;
      }
      voucher.status = "PROCESSING";
      return { ...voucher };
    },
    updateVoucher: async (id, data) => {
      const voucher = { ...vouchers.get(id)!, ...data };
      vouchers.set(id, voucher);
      return voucher;
    },
    listDuePendingIds: async (now) =>
      [...vouchers.values()]
        .filter(
          (voucher) =>
            voucher.status === "PENDING" && voucher.nextAttemptAt <= now,
        )
        .map((voucher) => voucher.id),
    listAwaitingAuthorization: async () =>
      [...vouchers.values()].filter(
        (v) => v.status === "AWAITING_AUTHORIZATION",
      ),
    releaseStuck: async () => 0,
    listOrdersWithRefunds: async () =>
      [...orders.values()]
        .filter((order) => order.refundedInCents > 0)
        .map((o) => o.id),
  };
  return { repository, vouchers };
}

function issued(request: VoucherRequest, number = 1): VoucherResult {
  return {
    state: "ISSUED",
    providerVoucherId: `fac-${request.idempotencyKey}`,
    pointOfSale: 3,
    number,
    cae: "75123456789012",
    caeExpiresAt: new Date("2026-10-20"),
    pdfUrl: "https://facturas.example/1.pdf",
  };
}

const baseOrder: OrderForInvoicing & { isPaid: boolean } = {
  id: "order-1",
  orderNumber: 120,
  isPaid: true,
  contactName: "Ana Pérez",
  customerDocument: "30111222",
  customerTaxId: null,
  customerLegalName: null,
  customerTaxCondition: null,
  shippingInCents: 500_000,
  totalInCents: 3_500_000,
  refundedInCents: 0,
  items: [
    {
      productName: "Remera",
      size: "M",
      color: "Negro",
      quantity: 1,
      lineTotalInCents: 1_000_000,
      clubId: null,
      clubSharePercentage: null,
    },
    {
      productName: "Camiseta Club",
      size: "L",
      color: "Sin definir",
      quantity: 2,
      lineTotalInCents: 2_000_000,
      clubId: "club-1",
      clubSharePercentage: 30,
    },
  ],
};

describe("servicio de facturación", () => {
  let orders: Map<string, OrderForInvoicing & { isPaid: boolean }>;
  let createVoucher: ReturnType<
    typeof vi.fn<(request: VoucherRequest) => Promise<VoucherResult>>
  >;
  let getVoucher: ReturnType<
    typeof vi.fn<(id: string) => Promise<VoucherResult>>
  >;
  let provider: InvoicingProvider;
  let now: Date;
  const onInvoiceIssued = vi.fn(async () => undefined);

  beforeEach(() => {
    orders = new Map([[baseOrder.id, structuredClone(baseOrder)]]);
    createVoucher = vi.fn(async (request: VoucherRequest) => issued(request));
    getVoucher = vi.fn();
    provider = { name: "fake", createVoucher, getVoucher };
    now = new Date("2026-10-10T12:00:00Z");
    onInvoiceIssued.mockClear();
  });

  function service(
    overrides: Partial<Parameters<typeof createInvoicingService>[0]> = {},
  ) {
    const memory = memoryRepository(orders);
    return {
      ...memory,
      service: createInvoicingService({
        repository: memory.repository,
        provider,
        config: {
          issuerTaxCondition: "MONOTRIBUTO",
          clubItemsMode: "TOTAL",
          vatRate: 21,
          pointOfSale: 3,
        },
        now: () => now,
        onInvoiceIssued,
        log: () => undefined,
        ...overrides,
      }),
    };
  }

  it("emite la factura del pedido pagado y avisa una sola vez", async () => {
    const { service: invoicing } = service();
    const voucher = await invoicing.requestInvoice("order-1");
    expect(voucher).toMatchObject({
      status: "ISSUED",
      voucherType: "FACTURA_C",
      amountInCents: 3_500_000,
      vatAmountInCents: 0,
      cae: "75123456789012",
      buyerDocType: "DNI",
      buyerDocNumber: "30111222",
    });
    expect(
      createVoucher.mock.calls[0]![0].lines.map((line) => line.description),
    ).toEqual(["Remera (M / Negro)", "Camiseta Club (L)", "Envío"]);
    expect(onInvoiceIssued).toHaveBeenCalledTimes(1);
  });

  it("un mismo pedido nunca genera dos facturas", async () => {
    const { service: invoicing, vouchers } = service();
    await invoicing.requestInvoice("order-1");
    await invoicing.requestInvoice("order-1");
    expect(vouchers.size).toBe(1);
    expect(createVoucher).toHaveBeenCalledTimes(1);
  });

  it("no factura pedidos impagos ni con la facturación desactivada", async () => {
    orders.get("order-1")!.isPaid = false;
    expect(await service().service.requestInvoice("order-1")).toBeNull();
    orders.get("order-1")!.isPaid = true;
    const disabled = service({ provider: null });
    expect(await disabled.service.requestInvoice("order-1")).toBeNull();
    expect(disabled.vouchers.size).toBe(0);
  });

  it("con STORE_SHARE factura solo la parte del taller", async () => {
    const { service: invoicing } = service({
      config: {
        issuerTaxCondition: "MONOTRIBUTO",
        clubItemsMode: "STORE_SHARE",
        vatRate: 21,
        pointOfSale: 3,
      },
    });
    const voucher = await invoicing.requestInvoice("order-1");
    // 10.000 propio + 20.000 × 70 % + 5.000 de envío
    expect(voucher?.amountInCents).toBe(2_900_000);
  });

  it("un responsable inscripto emite A con IVA discriminado a quien informa CUIT", async () => {
    Object.assign(orders.get("order-1")!, {
      customerTaxId: "30712345675",
      customerLegalName: "Club Social SA",
      customerTaxCondition: "RESPONSABLE_INSCRIPTO",
    });
    const { service: invoicing } = service({
      config: {
        issuerTaxCondition: "RESPONSABLE_INSCRIPTO",
        clubItemsMode: "TOTAL",
        vatRate: 21,
        pointOfSale: 3,
      },
    });
    const voucher = await invoicing.requestInvoice("order-1");
    expect(voucher).toMatchObject({
      voucherType: "FACTURA_A",
      buyerDocType: "CUIT",
      buyerName: "Club Social SA",
      netAmountInCents: 2_892_562,
      vatAmountInCents: 607_438,
    });
  });

  it("si el proveedor no responde, el pedido sigue y la factura se reintenta", async () => {
    createVoucher.mockRejectedValueOnce(new TransientInvoicingError("Timeout"));
    const { service: invoicing } = service();
    const pending = await invoicing.requestInvoice("order-1");
    expect(pending).toMatchObject({
      status: "PENDING",
      attempts: 1,
      errorMessage: "Timeout",
      nextAttemptAt: new Date("2026-10-10T12:01:00Z"),
    });
    // Antes del plazo no se reintenta.
    expect((await invoicing.runQueue()).processed).toBe(0);
    now = new Date("2026-10-10T12:02:00Z");
    expect((await invoicing.runQueue()).processed).toBe(1);
    expect((await invoicing.processVoucher(pending!.id))?.status).toBe(
      "ISSUED",
    );
  });

  it("después de agotar los reintentos queda con error para revisar", async () => {
    createVoucher.mockRejectedValue(new TransientInvoicingError("Caído"));
    const { service: invoicing, vouchers } = service();
    await invoicing.requestInvoice("order-1");
    for (let attempt = 0; attempt < 12; attempt += 1) {
      now = new Date(now.getTime() + 2 * 24 * 60 * 60_000);
      await invoicing.runQueue();
    }
    const [voucher] = [...vouchers.values()];
    expect(voucher?.status).toBe("FAILED");
    expect(voucher?.errorMessage).toMatch(/Se agotaron los reintentos/);
    createVoucher.mockImplementation(async (request) => issued(request));
    expect((await invoicing.retryVoucher(voucher!.id))?.status).toBe("ISSUED");
  });

  it("un rechazo de ARCA queda con error y no se reintenta solo", async () => {
    createVoucher.mockResolvedValueOnce({
      state: "REJECTED",
      providerVoucherId: "fac-9",
      message: "CUIT receptor inválido",
    });
    const { service: invoicing } = service();
    const voucher = await invoicing.requestInvoice("order-1");
    expect(voucher).toMatchObject({
      status: "FAILED",
      errorMessage: "CUIT receptor inválido",
    });
    now = new Date("2026-10-11T12:00:00Z");
    await invoicing.runQueue();
    expect(createVoucher).toHaveBeenCalledTimes(1);
  });

  it("cuando ARCA responde en diferido espera la notificación", async () => {
    createVoucher.mockResolvedValueOnce({
      state: "QUEUED",
      providerVoucherId: "fac-77",
    });
    const { service: invoicing } = service();
    const queued = await invoicing.requestInvoice("order-1");
    expect(queued).toMatchObject({
      status: "AWAITING_AUTHORIZATION",
      providerVoucherId: "fac-77",
    });
    expect(onInvoiceIssued).not.toHaveBeenCalled();

    getVoucher.mockResolvedValueOnce({
      state: "QUEUED",
      providerVoucherId: "fac-77",
    });
    expect((await invoicing.handleProviderNotification("fac-77"))?.status).toBe(
      "AWAITING_AUTHORIZATION",
    );
    getVoucher.mockResolvedValueOnce({
      state: "ISSUED",
      providerVoucherId: "fac-77",
      pointOfSale: 3,
      number: 15,
      cae: "123",
      caeExpiresAt: new Date("2026-10-20"),
      pdfUrl: null,
    });
    const done = await invoicing.handleProviderNotification("fac-77");
    expect(done).toMatchObject({ status: "ISSUED", number: 15 });
    expect(onInvoiceIssued).toHaveBeenCalledTimes(1);
    expect(await invoicing.handleProviderNotification("otro")).toBeNull();
  });

  it("emite notas de crédito parciales y totales por lo reintegrado", async () => {
    const { service: invoicing, vouchers } = service();
    await invoicing.requestInvoice("order-1");
    expect(await invoicing.syncCreditNotes("order-1")).toEqual([]);

    orders.get("order-1")!.refundedInCents = 1_000_000;
    const [partial] = await invoicing.syncCreditNotes("order-1");
    expect(partial).toMatchObject({
      kind: "CREDIT_NOTE",
      voucherType: "NOTA_CREDITO_C",
      amountInCents: 1_000_000,
      status: "ISSUED",
      relatedVoucherId: "v1",
    });
    const request = createVoucher.mock.calls[1]![0];
    expect(request.relatedVoucher).toMatchObject({ pointOfSale: 3, number: 1 });
    expect(
      request.lines.reduce((total, line) => total + line.totalInCents, 0),
    ).toBe(1_000_000);

    // Sin reintegros nuevos no se repite.
    expect(await invoicing.syncCreditNotes("order-1")).toEqual([]);

    orders.get("order-1")!.refundedInCents = 3_500_000;
    const [rest] = await invoicing.syncCreditNotes("order-1");
    expect(rest?.amountInCents).toBe(2_500_000);
    expect(
      [...vouchers.values()].filter((v) => v.kind === "CREDIT_NOTE"),
    ).toHaveLength(2);
    expect(onInvoiceIssued).toHaveBeenCalledTimes(1);
  });

  it("la tarea periódica genera las notas de crédito pendientes", async () => {
    const { service: invoicing } = service();
    await invoicing.requestInvoice("order-1");
    orders.get("order-1")!.refundedInCents = 500_000;
    expect(await invoicing.runQueue()).toMatchObject({ creditNotes: 1 });
    expect(await invoicing.runQueue()).toMatchObject({ creditNotes: 0 });
  });

  it("sin factura emitida no hay nota de crédito", async () => {
    orders.get("order-1")!.refundedInCents = 500_000;
    const { service: invoicing } = service();
    expect(await invoicing.syncCreditNotes("order-1")).toEqual([]);
  });
});
