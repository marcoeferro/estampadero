import { describe, expect, it, vi } from "vitest";

import type { OrderDetailDto, OrderItemDto } from "elestampadero/server/modules/orders";

import type { CommissionsRepository } from "../ports/commissions-repository";
import { generateCommissionEntriesForOrder } from "./generate-commission-entries-for-order";

function makeItem(overrides: Partial<OrderItemDto> = {}): OrderItemDto {
  return {
    id: "item-1",
    productId: "product-1",
    productName: "Remera",
    productSlug: "remera",
    size: "M",
    color: "Negro",
    imageUrl: null,
    priceInCentsSnapshot: 10_000,
    quantity: 1,
    lineTotalInCents: 10_000,
    clubId: null,
    clubNameSnapshot: null,
    clubAgreementId: null,
    clubSharePercentage: null,
    ...overrides,
  };
}

function makeOrder(items: OrderItemDto[]): OrderDetailDto {
  return {
    id: "order-1",
    orderNumber: 1,
    status: "PAID",
    contactName: "Juana Pérez",
    contactEmail: "juana@example.com",
    contactPhone: "1122334455",
    deliveryMethod: "PICKUP",
    shippingAddress: null,
    shippingCity: null,
    shippingPostalCode: null,
    subtotalInCents: items.reduce((sum, item) => sum + item.lineTotalInCents, 0),
    shippingInCents: 0,
    totalInCents: items.reduce((sum, item) => sum + item.lineTotalInCents, 0),
    createdAt: new Date().toISOString(),
    items,
  };
}

function makeRepository(
  overrides: Partial<CommissionsRepository> = {},
): CommissionsRepository {
  return {
    createEntryIfNotExists: vi.fn(),
    listByClub: vi.fn(),
    getClubBalance: vi.fn(),
    ...overrides,
  };
}

describe("generateCommissionEntriesForOrder", () => {
  it("skips items with no club (direct-to-consumer sales)", async () => {
    const repository = makeRepository();
    const resolveRateForProduct = vi.fn();
    const order = makeOrder([makeItem({ clubId: null })]);

    await generateCommissionEntriesForOrder({ repository, resolveRateForProduct })(order);

    expect(resolveRateForProduct).not.toHaveBeenCalled();
    expect(repository.createEntryIfNotExists).not.toHaveBeenCalled();
  });

  it("skips club items that have no active agreement rate", async () => {
    const repository = makeRepository();
    const resolveRateForProduct = vi.fn(async () => null);
    const order = makeOrder([makeItem({ clubId: "club-1" })]);

    await generateCommissionEntriesForOrder({ repository, resolveRateForProduct })(order);

    expect(repository.createEntryIfNotExists).not.toHaveBeenCalled();
  });

  it("computes the commission amount from the line total and the resolved percentage", async () => {
    const repository = makeRepository();
    const resolveRateForProduct = vi.fn(async () => ({
      agreementId: "agreement-1",
      percentage: 15,
    }));
    const order = makeOrder([
      makeItem({ clubId: "club-1", lineTotalInCents: 10_000 }),
    ]);

    await generateCommissionEntriesForOrder({ repository, resolveRateForProduct })(order);

    expect(repository.createEntryIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        clubId: "club-1",
        agreementId: "agreement-1",
        baseAmountInCents: 10_000,
        percentageApplied: 15,
        amountInCents: 1_500,
      }),
    );
  });

  it("rounds to the nearest cent instead of truncating or accumulating drift", async () => {
    const repository = makeRepository();

    const resolveRateForProduct = vi.fn(async () => ({
      agreementId: "agreement-1",
      percentage: 12.5,
    }));
    const order = makeOrder([makeItem({ clubId: "club-1", lineTotalInCents: 333 })]);

    await generateCommissionEntriesForOrder({ repository, resolveRateForProduct })(order);

    expect(repository.createEntryIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({ amountInCents: 42 }),
    );
  });

  it("generates one entry per club line item, each against its own resolved rate", async () => {
    const repository = makeRepository();
    const resolveRateForProduct = vi.fn(async (_clubId: string, productId: string) =>
      productId === "product-1"
        ? { agreementId: "agreement-1", percentage: 10 }
        : { agreementId: "agreement-2", percentage: 20 },
    );
    const order = makeOrder([
      makeItem({ id: "item-1", productId: "product-1", clubId: "club-1", lineTotalInCents: 10_000 }),
      makeItem({ id: "item-2", productId: "product-2", clubId: "club-1", lineTotalInCents: 5_000 }),
      makeItem({ id: "item-3", clubId: null }),
    ]);

    await generateCommissionEntriesForOrder({ repository, resolveRateForProduct })(order);

    expect(repository.createEntryIfNotExists).toHaveBeenCalledTimes(2);
    expect(repository.createEntryIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({ orderItemId: "item-1", amountInCents: 1_000 }),
    );
    expect(repository.createEntryIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({ orderItemId: "item-2", amountInCents: 1_000 }),
    );
  });

  it("uses the rate stored on the order item instead of the current agreement", async () => {
    const repository = makeRepository();
    const resolveRateForProduct = vi.fn(async () => ({
      agreementId: "agreement-new",
      percentage: 30,
    }));
    const order = makeOrder([
      makeItem({
        clubId: "club-1",
        lineTotalInCents: 10_000,
        clubAgreementId: "agreement-old",
        clubSharePercentage: 20,
      }),
    ]);

    await generateCommissionEntriesForOrder({ repository, resolveRateForProduct })(order);

    expect(resolveRateForProduct).not.toHaveBeenCalled();
    expect(repository.createEntryIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        agreementId: "agreement-old",
        percentageApplied: 20,
        amountInCents: 2_000,
      }),
    );
  });
});
