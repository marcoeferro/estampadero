import { describe, expect, it, vi } from "vitest";

import type { OrderItemDto } from "elestampadero/server/modules/orders";

import {
  computeMobbexSplit,
  SplitConfigurationError,
  type SplitClub,
} from "./mobbex-split-calculation";

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

function makeOrder(items: OrderItemDto[], shippingInCents = 0) {
  return {
    orderNumber: 7,
    totalInCents:
      items.reduce((sum, item) => sum + item.lineTotalInCents, 0) +
      shippingInCents,
    items,
  };
}

const clubs: SplitClub[] = [
  { id: "club-a", name: "Club A", entityId: "entity-a" },
  { id: "club-b", name: "Club B", entityId: "entity-b" },
  { id: "club-off", name: "Club Inactivo", entityId: null },
];

function deps(
  overrides: Partial<Parameters<typeof computeMobbexSplit>[1]> = {},
) {
  return {
    clubs,
    resolveRate: vi.fn(async () => null),
    originatorEntityId: "entity-store",
    ...overrides,
  };
}

describe("computeMobbexSplit", () => {
  it("does not split orders with only store products", async () => {
    const order = makeOrder([makeItem()], 5_000);

    await expect(computeMobbexSplit(order, deps())).resolves.toBeUndefined();
  });

  it("gives the club the gross amount and the store its share as fee", async () => {
    const order = makeOrder([
      makeItem({ clubId: "club-a", clubSharePercentage: 20 }),
    ]);

    const split = await computeMobbexSplit(order, deps());

    expect(split).toEqual([
      expect.objectContaining({
        entity: "entity-a",
        totalInCents: 10_000,
        feeInCents: 8_000,
      }),
    ]);
  });

  it("groups lines per club and assigns store products and shipping to the originator", async () => {
    const order = makeOrder(
      [
        makeItem({
          id: "1",
          clubId: "club-a",
          clubSharePercentage: 10,
          lineTotalInCents: 10_000,
        }),
        makeItem({
          id: "2",
          clubId: "club-a",
          clubSharePercentage: 20,
          lineTotalInCents: 5_000,
        }),
        makeItem({
          id: "3",
          clubId: "club-b",
          clubSharePercentage: 50,
          lineTotalInCents: 4_000,
        }),
        makeItem({ id: "4", lineTotalInCents: 3_000 }),
      ],
      6_200,
    );

    const split = await computeMobbexSplit(order, deps());

    expect(split).toEqual([
      expect.objectContaining({
        entity: "entity-a",
        totalInCents: 15_000,
        feeInCents: 13_000,
      }),
      expect.objectContaining({
        entity: "entity-b",
        totalInCents: 4_000,
        feeInCents: 2_000,
      }),
      expect.objectContaining({
        entity: "entity-store",
        totalInCents: 9_200,
        feeInCents: 0,
      }),
    ]);
    const total = split!.reduce((sum, item) => sum + item.totalInCents, 0);
    expect(total).toBe(order.totalInCents);
  });

  it("rounds each line to the cent and keeps the split total exact", async () => {
    const order = makeOrder([
      makeItem({
        id: "1",
        clubId: "club-a",
        clubSharePercentage: 12.5,
        lineTotalInCents: 333,
      }),
      makeItem({
        id: "2",
        clubId: "club-a",
        clubSharePercentage: 12.5,
        lineTotalInCents: 333,
      }),
    ]);

    const split = await computeMobbexSplit(order, deps());

    expect(split).toEqual([
      expect.objectContaining({ totalInCents: 666, feeInCents: 666 - 84 }),
    ]);
  });

  it("prefers the stored percentage over the current agreement", async () => {
    const resolveRate = vi.fn(async () => ({ percentage: 90 }));
    const order = makeOrder([
      makeItem({ clubId: "club-a", clubSharePercentage: 20 }),
    ]);

    const split = await computeMobbexSplit(order, deps({ resolveRate }));

    expect(resolveRate).not.toHaveBeenCalled();
    expect(split?.[0]?.feeInCents).toBe(8_000);
  });

  it("falls back to the current agreement for orders without a stored percentage", async () => {
    const resolveRate = vi.fn(async () => ({ percentage: 25 }));
    const order = makeOrder([makeItem({ clubId: "club-a" })]);

    const split = await computeMobbexSplit(order, deps({ resolveRate }));

    expect(split?.[0]?.feeInCents).toBe(7_500);
  });

  it("rejects clubs whose payments are not active, naming the club", async () => {
    const order = makeOrder([
      makeItem({ clubId: "club-off", clubSharePercentage: 20 }),
    ]);

    await expect(computeMobbexSplit(order, deps())).rejects.toThrow(
      new SplitConfigurationError(
        "Club Inactivo todavía no tiene los cobros activos.",
      ),
    );
  });

  it("requires the originator entity when the store keeps part of the order", async () => {
    const order = makeOrder(
      [makeItem({ clubId: "club-a", clubSharePercentage: 20 })],
      6_200,
    );

    await expect(
      computeMobbexSplit(order, deps({ originatorEntityId: null })),
    ).rejects.toBeInstanceOf(SplitConfigurationError);
  });
});
