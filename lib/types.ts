import { z } from "zod";

/**
 * Shared contracts for the four pipeline stages.
 *
 * Every boundary in this system is a validated schema rather than a bare
 * object. That matters most at the PERCEIVE boundary: model output is
 * untrusted input, and parsing it through Zod is what stops a malformed or
 * adversarial response from reaching the policy engine.
 */

/** What the vision model is allowed to report. A closed set, not free text. */
export const DamageType = z.enum([
  "cracked_screen",
  "physical_damage",
  "water_damage",
  "packaging_damage",
  "wrong_item",
  "missing_parts",
  "cosmetic_defect",
  "no_damage_visible",
  "unclear",
]);
export type DamageType = z.infer<typeof DamageType>;

export const ProductCategory = z.enum([
  "electronics",
  "apparel",
  "home",
  "other",
]);
export type ProductCategory = z.infer<typeof ProductCategory>;

/**
 * STAGE 2 OUTPUT — what the model saw.
 *
 * Note what is absent: no recommendation, no remedy, no monetary amount.
 * The perception stage reports observations only. It is structurally
 * incapable of proposing an outcome.
 */
export const PerceptionResult = z.object({
  item_type: z.string().min(1).max(120),
  damage_type: DamageType,
  /** 1 = cosmetic blemish, 5 = item destroyed / unusable. */
  severity: z.number().int().min(1).max(5),
  /** Concrete things visible in the photo, in the model's own words. */
  visible_evidence: z.array(z.string().max(300)).max(8),
  /** Model's self-reported certainty, 0..1. Gates the confidence rule. */
  confidence: z.number().min(0).max(1),
  /** True when the photo is too dark, blurry, or cropped to judge. */
  is_ambiguous: z.boolean(),
  notes: z.string().max(600),
});
export type PerceptionResult = z.infer<typeof PerceptionResult>;

/**
 * Account facts. In production these come from the order system, never from
 * the customer and never from the model — they are the trusted half of the
 * adjudication input.
 */
export const OrderContext = z.object({
  order_id: z.string(),
  item_name: z.string(),
  item_value: z.number().nonnegative(),
  days_since_delivery: z.number().int().nonnegative(),
  category: ProductCategory,
  prior_claims_count: z.number().int().nonnegative(),
});
export type OrderContext = z.infer<typeof OrderContext>;

export const ClaimAction = z.enum(["refund", "replace", "escalate", "reject"]);
export type ClaimAction = z.infer<typeof ClaimAction>;

/** An audit record of one rule that participated in the decision. */
export const RuleFired = z.object({
  id: z.string(),
  description: z.string(),
  outcome: z.string(),
});
export type RuleFired = z.infer<typeof RuleFired>;

/**
 * STAGE 3 OUTPUT — the decision.
 *
 * Produced only by `adjudicate()`. No model output ever constructs this
 * object, which is the property the whole design exists to preserve.
 */
export const Decision = z.object({
  action: ClaimAction,
  /** Payout in policy currency. Always 0 for replace / escalate / reject. */
  amount: z.number().nonnegative(),
  /** Ordered audit trail: which rules were evaluated and what they concluded. */
  rules_fired: z.array(RuleFired),
  /** Plain-language justification, assembled from the rule that decided. */
  reason: z.string(),
  /** True when a human must review before anything is communicated. */
  requires_human: z.boolean(),
  policy_version: z.string(),
});
export type Decision = z.infer<typeof Decision>;

/** STAGE 4 OUTPUT — customer-facing copy, constrained to the decision above. */
export const ComposedResponse = z.object({
  customer_message: z.string(),
  ticket_subject: z.string(),
  internal_summary: z.string(),
});
export type ComposedResponse = z.infer<typeof ComposedResponse>;

/**
 * Request body accepted by POST /api/resolve.
 *
 * SECURITY: this schema deliberately carries NO monetary or order fields —
 * only an `order_id` reference. The server looks the real record up in the
 * order system (`lib/orders.ts`) and ignores anything else the caller might
 * try to supply.
 *
 * An earlier version accepted the whole `OrderContext` from the client, which
 * meant a crafted request could claim a ₹899 mug was worth ₹14,999 and be
 * refunded the larger amount. Removing the field is what makes "the customer
 * never controls the money" a property of the API rather than a property of
 * the UI — a hidden form field is not a security boundary.
 */
export const ResolveRequest = z.object({
  /** Base64 image data URL, or omitted when running a bundled sample. */
  image_base64: z.string().optional(),
  image_mime_type: z.string().optional(),
  description: z.string().max(1000),
  /** Reference only. The server resolves this to a trusted order record. */
  order_id: z.string().min(1).max(64),
  /** Set when replaying a bundled sample case; enables the cached path. */
  sample_id: z.string().optional(),
});
export type ResolveRequest = z.infer<typeof ResolveRequest>;

/** How the response was produced — surfaced in the UI for honesty. */
export const ResolveSource = z.enum(["live", "cached"]);
export type ResolveSource = z.infer<typeof ResolveSource>;

export const ResolveResponse = z.object({
  perception: PerceptionResult,
  decision: Decision,
  composed: ComposedResponse,
  source: ResolveSource,
  /** Present when falling back to cache, explaining why. */
  fallback_reason: z.string().optional(),
  timings_ms: z.object({
    perceive: z.number(),
    adjudicate: z.number(),
    compose: z.number(),
  }),
});
export type ResolveResponse = z.infer<typeof ResolveResponse>;
