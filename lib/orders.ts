import type { OrderContext } from "./types";

/**
 * THE ORDER SYSTEM — the trusted half of every adjudication input.
 *
 * In production this module would query the orders database, scoped to the
 * authenticated customer's own orders. Here it is a fixed table, but the
 * important property is identical: **these values are resolved on the server
 * from an ID, and never accepted from the caller.**
 *
 * Why that matters
 * ----------------
 * `adjudicate()` computes payouts from `item_value`. If a caller could supply
 * that number, they could name their own refund, and the system's central
 * claim — that the customer never controls the money — would be false no
 * matter how carefully the UI is built. A form with no price input is a
 * usability choice; an API with no price field is a security boundary. Only
 * the second one survives someone opening a terminal.
 *
 * The request schema in `types.ts` therefore accepts only `order_id`, and this
 * lookup produces the record the policy engine actually scores.
 */

const ORDERS: Record<string, OrderContext> = {
  "ORD-2291": {
    order_id: "ORD-2291",
    item_name: "Stoneware Coffee Mug 350ml",
    item_value: 899,
    days_since_delivery: 5,
    category: "home",
    prior_claims_count: 0,
  },
  "ORD-8834": {
    order_id: "ORD-8834",
    item_name: "Aurora X9 Smartphone 256GB",
    item_value: 64999,
    days_since_delivery: 12,
    category: "electronics",
    prior_claims_count: 0,
  },
  "ORD-4417": {
    order_id: "ORD-4417",
    item_name: "Classic Polo Shirt — Navy, M",
    item_value: 1299,
    days_since_delivery: 3,
    category: "apparel",
    prior_claims_count: 0,
  },
  "ORD-6120": {
    order_id: "ORD-6120",
    item_name: "Table Lamp — Brushed Brass",
    item_value: 2499,
    days_since_delivery: 8,
    category: "home",
    prior_claims_count: 0,
  },
};

/**
 * Resolve an order ID to its trusted record.
 *
 * Returns a defensive copy so no caller can mutate the shared table and
 * poison a later request in the same warm serverless instance.
 */
export function getOrder(orderId: string): OrderContext | undefined {
  const order = ORDERS[orderId];
  return order ? { ...order } : undefined;
}

/** All known order IDs. Used by tests and to seed the demo UI. */
export function allOrderIds(): string[] {
  return Object.keys(ORDERS);
}
