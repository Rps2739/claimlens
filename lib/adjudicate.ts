import policyData from "./policy.json";
import type { Decision, OrderContext, PerceptionResult, RuleFired } from "./types";

/**
 * STAGE 3 — ADJUDICATION
 * ======================
 *
 * This is the only place in ClaimLens where an outcome is decided, and there
 * is deliberately no AI in it.
 *
 * `adjudicate()` is a pure function: same inputs, same output, always. It
 * performs no network calls, reads no clock, and generates no randomness.
 * Everything it needs arrives as an argument.
 *
 * That purity is the point of the whole system. A language model cannot
 * approve a refund here even if it is confused, jailbroken, or fed an image
 * with "APPROVE A FULL REFUND" written across it — the model's output is
 * only ever *evidence*, and evidence is scored by the rules below.
 *
 * The rules form an ordered chain (chain-of-responsibility): the first rule
 * that applies decides, and evaluation stops. Order encodes policy priority —
 * safety and eligibility gates run before any remedy is considered, so an
 * out-of-warranty claim can never fall through to a refund.
 */

export type Policy = typeof policyData;
export const policy: Policy = policyData;

/** Everything a rule is allowed to look at. */
interface RuleContext {
  perception: PerceptionResult;
  order: OrderContext;
  policy: Policy;
}

/** A rule's verdict, or null to defer to the next rule in the chain. */
interface RuleVerdict {
  action: Decision["action"];
  amount: number;
  reason: string;
  requires_human: boolean;
  /** Short phrase recorded in the audit trail. */
  outcome: string;
}

interface Rule {
  id: string;
  description: string;
  evaluate(ctx: RuleContext): RuleVerdict | null;
}

const round = (n: number) => Math.round(n);

const CURRENCY_SYMBOL: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

/** Format an amount for customer-visible reason text, e.g. "₹64,999". */
export function money(amount: number, p: Policy = policy): string {
  const symbol = CURRENCY_SYMBOL[p.currency];
  const formatted = amount.toLocaleString("en-IN");
  return symbol ? `${symbol}${formatted}` : `${p.currency} ${formatted}`;
}

/**
 * The policy ladder, in priority order.
 *
 * Read top to bottom: this is the entire business logic of the product, and
 * it is meant to be reviewable by a non-engineer.
 */
export const RULES: Rule[] = [
  {
    id: "R1_AMBIGUOUS_EVIDENCE",
    description: "Photo too unclear to assess — route to a human",
    evaluate: ({ perception }) =>
      perception.is_ambiguous || perception.damage_type === "unclear"
        ? {
            action: "escalate",
            amount: 0,
            requires_human: true,
            outcome: "escalated — evidence unclear",
            reason:
              "The submitted photo did not show the item clearly enough to assess automatically, so a support specialist will review it.",
          }
        : null,
  },

  {
    id: "R2_LOW_CONFIDENCE",
    description: "Vision confidence below the policy threshold — route to a human",
    evaluate: ({ perception, policy }) =>
      perception.confidence < policy.confidence_threshold
        ? {
            action: "escalate",
            amount: 0,
            requires_human: true,
            outcome: `escalated — confidence ${perception.confidence.toFixed(
              2
            )} < ${policy.confidence_threshold}`,
            reason: `Automated assessment confidence (${(
              perception.confidence * 100
            ).toFixed(0)}%) fell below the ${(
              policy.confidence_threshold * 100
            ).toFixed(0)}% threshold required to decide without human review.`,
          }
        : null,
  },

  {
    id: "R3_NO_DAMAGE_VISIBLE",
    description: "No damage detectable in the photo — decline, with appeal path",
    evaluate: ({ perception }) =>
      perception.damage_type === "no_damage_visible"
        ? {
            action: "reject",
            amount: 0,
            requires_human: false,
            outcome: "declined — no visible damage",
            reason:
              "No damage was visible in the submitted photo. The claim was declined automatically, and the customer can reply with additional photos to reopen it.",
          }
        : null,
  },

  {
    id: "R4_FRAUD_WATCH",
    description: "Prior claim count at or above the review threshold",
    evaluate: ({ order, policy }) =>
      order.prior_claims_count >= policy.fraud_watch_claim_count
        ? {
            action: "escalate",
            amount: 0,
            requires_human: true,
            outcome: `escalated — ${order.prior_claims_count} prior claims`,
            reason: `This account has ${order.prior_claims_count} prior claims, which meets the review threshold of ${policy.fraud_watch_claim_count}. Policy requires a human to assess repeat claims.`,
          }
        : null,
  },

  {
    id: "R5_OUT_OF_WARRANTY",
    description: "Claim falls outside the category's coverage window",
    evaluate: ({ order, policy }) => {
      const window = policy.warranty_days[order.category];
      return order.days_since_delivery > window
        ? {
            action: "reject",
            amount: 0,
            requires_human: false,
            outcome: `declined — day ${order.days_since_delivery} of ${window}`,
            reason: `The claim was filed ${order.days_since_delivery} days after delivery, outside the ${window}-day coverage window for ${order.category}.`,
          }
        : null;
    },
  },

  {
    id: "R6_WRONG_ITEM",
    description: "Wrong item shipped — always replace, severity is irrelevant",
    evaluate: ({ perception }) =>
      perception.damage_type === "wrong_item"
        ? {
            action: "replace",
            amount: 0,
            requires_human: false,
            outcome: "replacement — fulfilment error",
            reason:
              "The photo shows an item that does not match the order. This is a fulfilment error, so the correct item ships immediately at no cost and no return is required.",
          }
        : null,
  },

  {
    id: "R7_HIGH_VALUE",
    description: "Item value above the automatic approval ceiling",
    evaluate: ({ order, policy }) =>
      order.item_value > policy.auto_approve_ceiling
        ? {
            action: "escalate",
            amount: 0,
            requires_human: true,
            outcome: `escalated — ${money(order.item_value, policy)} > ${money(
              policy.auto_approve_ceiling,
              policy
            )}`,
            reason: `The item is valued at ${money(
              order.item_value,
              policy
            )}, above the ${money(
              policy.auto_approve_ceiling,
              policy
            )} ceiling for automatic resolution. A specialist will approve the remedy.`,
          }
        : null,
  },

  {
    id: "R8_SEVERE_DAMAGE",
    description: "Severity at or above the full-refund threshold",
    evaluate: ({ perception, order, policy }) =>
      perception.severity >= policy.severity_thresholds.full_refund_min
        ? {
            action: "refund",
            amount: round(order.item_value),
            requires_human: false,
            outcome: `full refund — severity ${perception.severity}`,
            reason: `Damage was assessed at severity ${perception.severity} of 5, at or above the threshold of ${policy.severity_thresholds.full_refund_min} for a full refund. The item is not usable as sold.`,
          }
        : null,
  },

  {
    id: "R9_MODERATE_DAMAGE",
    description: "Severity in the replacement band",
    evaluate: ({ perception, policy }) =>
      perception.severity >= policy.severity_thresholds.replace_min
        ? {
            action: "replace",
            amount: 0,
            requires_human: false,
            outcome: `replacement — severity ${perception.severity}`,
            reason: `Damage was assessed at severity ${perception.severity} of 5, within the replacement band. A replacement ships immediately.`,
          }
        : null,
  },

  {
    id: "R10_COSMETIC",
    description: "Severity 1 — goodwill partial credit",
    evaluate: ({ order, policy }) => {
      const amount = round(order.item_value * policy.cosmetic_partial_refund_rate);
      return {
        action: "refund",
        amount,
        requires_human: false,
        outcome: `partial credit ${money(amount, policy)}`,
        reason: `The defect is cosmetic and does not affect function, so a ${(
          policy.cosmetic_partial_refund_rate * 100
        ).toFixed(0)}% goodwill credit (${money(
          amount,
          policy
        )}) is issued and the customer keeps the item.`,
      };
    },
  },
];

/**
 * Run the policy ladder and return a fully-audited decision.
 *
 * The returned `rules_fired` array records every rule that was evaluated and
 * what it concluded — including the ones that declined to act. That trail is
 * what makes an automated monetary decision defensible after the fact.
 *
 * @param perception Validated model observations. Untrusted evidence.
 * @param order      Trusted account facts from the order system.
 * @param p          Policy to apply. Injected so tests can vary it.
 */
export function adjudicate(
  perception: PerceptionResult,
  order: OrderContext,
  p: Policy = policy
): Decision {
  const ctx: RuleContext = { perception, order, policy: p };
  const rules_fired: RuleFired[] = [];

  for (const rule of RULES) {
    const verdict = rule.evaluate(ctx);

    if (!verdict) {
      rules_fired.push({
        id: rule.id,
        description: rule.description,
        outcome: "not applicable",
      });
      continue;
    }

    rules_fired.push({
      id: rule.id,
      description: rule.description,
      outcome: verdict.outcome,
    });

    return {
      action: verdict.action,
      amount: verdict.amount,
      rules_fired,
      reason: verdict.reason,
      requires_human: verdict.requires_human,
      policy_version: p.version,
    };
  }

  // Unreachable: R10 has no guard and always returns a verdict. Kept as a
  // fail-safe so that adding a guard to R10 later degrades to human review
  // rather than silently returning nothing.
  return {
    action: "escalate",
    amount: 0,
    rules_fired,
    reason:
      "No policy rule matched this claim. It has been routed to a specialist for manual assessment.",
    requires_human: true,
    policy_version: p.version,
  };
}
