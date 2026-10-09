import { describe, expect, it } from "vitest";

import { refundAdjustmentSchedule } from "./refund-adjustment-schedule";

const now = new Date("2026-10-10T12:00:00Z");
const releasedAt = new Date("2026-10-01T12:00:00Z");
const availableAt = new Date("2026-10-20T12:00:00Z");

describe("refundAdjustmentSchedule", () => {
  it("settles Mobbex adjustments immediately so they never reach a manual settlement", () => {
    expect(
      refundAdjustmentSchedule({
        provider: "MOBBEX",
        sale: { status: "SETTLED", releasedAt, availableAt: null },
        now,
      }),
    ).toEqual({ status: "SETTLED", releasedAt: now, availableAt: null });
  });

  it.each(["SETTLED", "IN_SETTLEMENT"] as const)(
    "makes a %s legacy sale's adjustment available for the next settlement",
    (status) => {
      expect(
        refundAdjustmentSchedule({
          provider: "MERCADO_PAGO",
          sale: { status, releasedAt, availableAt },
          now,
        }),
      ).toEqual({ status: "AVAILABLE", releasedAt, availableAt: now });
    },
  );

  it("follows a pending legacy sale", () => {
    expect(
      refundAdjustmentSchedule({
        provider: "PAYWAY",
        sale: { status: "RETURN_WINDOW", releasedAt, availableAt },
        now,
      }),
    ).toEqual({ status: "RETURN_WINDOW", releasedAt, availableAt });
  });
});
