import { describe, expect, it } from "vitest";
import { adjudicate } from "../lib/adjudicate";
import { allOrderIds, getOrder } from "../lib/orders";
import { SAMPLES } from "../lib/samples";
import { ResolveRequest } from "../lib/types";

/**
 * Tests for the trust boundary around order data.
 *
 * REGRESSION: an earlier version of `ResolveRequest` accepted the whole
 * `OrderContext` from the client. Because `item_value` drives the payout, a
 * crafted request could claim a ₹899 mug was worth ₹14,999 and be refunded
 * the larger figure — the UI having no price field was irrelevant, since the
 * API is the real boundary. These tests keep that hole closed.
 */

describe("request schema rejects caller-supplied money", () => {
  it("has no order/price fields in its accepted shape", () => {
    const parsed = ResolveRequest.parse({
      description: "broken",
      order_id: "ORD-2291",
      // Everything below is what an attacker would send. Zod strips unknown
      // keys, so none of it survives into the handler.
      order: { order_id: "ORD-2291", item_value: 9_999_999 },
      item_value: 9_999_999,
      amount: 9_999_999,
    } as never);

    expect(parsed).not.toHaveProperty("order");
    expect(parsed).not.toHaveProperty("item_value");
    expect(parsed).not.toHaveProperty("amount");
    expect(parsed.order_id).toBe("ORD-2291");
  });

  it("requires an order_id", () => {
    expect(ResolveRequest.safeParse({ description: "x" }).success).toBe(false);
  });

  it("rejects an empty order_id", () => {
    expect(
      ResolveRequest.safeParse({ description: "x", order_id: "" }).success
    ).toBe(false);
  });
});

describe("order lookup is authoritative", () => {
  it("resolves every known order", () => {
    for (const id of allOrderIds()) {
      expect(getOrder(id)?.order_id, id).toBe(id);
    }
  });

  it("returns undefined for an unknown order rather than a default", () => {
    expect(getOrder("ORD-DOES-NOT-EXIST")).toBeUndefined();
    expect(getOrder("")).toBeUndefined();
  });

  it("hands out copies so a caller cannot poison the shared table", () => {
    const first = getOrder("ORD-2291")!;
    first.item_value = 9_999_999;

    // A mutation on one caller's copy must not leak into the next request.
    expect(getOrder("ORD-2291")!.item_value).toBe(899);
  });

  it("prices the mug at its real value, not an inflated one", () => {
    // The exact exploit: forged 14999 against a real price of 899.
    const real = getOrder("ORD-2291")!;
    expect(real.item_value).toBe(899);

    const sample = SAMPLES.find((s) => s.id === "mug")!;
    const decision = adjudicate(sample.cachedPerception, real);

    expect(decision.action).toBe("refund");
    expect(decision.amount).toBe(899);
    expect(decision.amount).toBeLessThan(14_999);
  });
});

describe("samples stay in sync with the order system", () => {
  it("every sample's order matches the authoritative record exactly", () => {
    for (const s of SAMPLES) {
      const authoritative = getOrder(s.order.order_id);
      expect(authoritative, `${s.id} references a real order`).toBeDefined();
      expect(s.order, `${s.id} order matches the order system`).toEqual(
        authoritative
      );
    }
  });
});
