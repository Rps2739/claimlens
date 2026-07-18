import "server-only";
import { MODEL, classifyError, getClient, withTimeout } from "./gemini";
import { money } from "./adjudicate";
import { ComposedResponse } from "./types";
import type { Decision, OrderContext, PerceptionResult } from "./types";

/**
 * STAGE 4 — COMPOSITION
 * =====================
 *
 * Writes the customer-facing message.
 *
 * By the time this runs the outcome is already fixed. The model is told what
 * was decided and asked to explain it well — it is a writer, not a decision
 * maker, and it never sees the policy thresholds that produced the outcome.
 *
 * This ordering is why the system can use a language model for customer
 * communication without risking a promise it cannot keep: there is no path
 * from generated text back into the decision.
 */

const COMPOSE_TIMEOUT_MS = 20_000;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    customer_message: {
      type: "string",
      description: "The message sent to the customer. 2-4 short paragraphs.",
    },
    ticket_subject: {
      type: "string",
      description: "One-line CRM ticket subject, under 80 characters.",
    },
    internal_summary: {
      type: "string",
      description: "One or two sentences for the support agent's queue.",
    },
  },
  required: ["customer_message", "ticket_subject", "internal_summary"],
} as const;

const SYSTEM_PROMPT = `You write customer support messages for an e-commerce company.

A decision has ALREADY been made by the company's policy engine. You are writing the message that communicates it. You are not deciding anything.

Absolute constraints:
- Communicate exactly the decision you are given. Never promise a different or additional remedy.
- Never state a monetary amount other than the exact amount provided. If the amount is 0, do not mention money at all.
- Never speculate about what "might" be possible, never hint that a different outcome could be arranged, and never invent timelines, policy numbers, or terms you were not given.
- If the decision requires human review, say a specialist will follow up. Do not predict what they will conclude.

Tone:
- Warm, direct, and human. Short sentences. No corporate padding.
- Open with the outcome. Customers want the answer first, not a preamble.
- Acknowledge the inconvenience once, genuinely, then move to specifics.
- Never blame the customer, and never imply the claim was suspicious.
- Do not use the words "unfortunately" or "we regret to inform you".`;

/** Human-readable outcome line given to the writer. */
function describeOutcome(decision: Decision): string {
  switch (decision.action) {
    case "refund":
      return `REFUND of ${money(
        decision.amount
      )}, being issued to the original payment method (5-7 business days).`;
    case "replace":
      return `REPLACEMENT shipping at no cost. No return of the damaged item is required.`;
    case "escalate":
      return `ESCALATED to a human specialist, who will follow up within 24 hours. No outcome has been decided yet.`;
    case "reject":
      return `CLAIM DECLINED. The customer may reply with additional photos to have it reviewed again.`;
  }
}

/**
 * Generate customer-facing copy for a decision that has already been made.
 *
 * @param decision   The fixed outcome. Not negotiable by this stage.
 * @param perception Observations, so the message can reference the damage.
 * @param order      Order details for personalisation.
 */
export async function compose(
  decision: Decision,
  perception: PerceptionResult,
  order: OrderContext
): Promise<ComposedResponse> {
  const ai = getClient();

  // Note what is deliberately absent: policy thresholds, the rule ladder, and
  // the reasoning behind the outcome. The writer gets the conclusion and the
  // evidence, not the levers.
  const brief = `ORDER
  Order ID: ${order.order_id}
  Item: ${order.item_name} (${money(order.item_value)})
  Delivered: ${order.days_since_delivery} days ago

WHAT THE INSPECTION FOUND
  Item in photo: ${perception.item_type}
  Damage type: ${perception.damage_type.replace(/_/g, " ")}
  Severity: ${perception.severity} of 5
  Visible: ${perception.visible_evidence.join("; ") || "not specified"}

THE DECISION YOU MUST COMMUNICATE
  ${describeOutcome(decision)}

  Company's internal reason: ${decision.reason}

Write the message.`;

  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: MODEL,
        contents: brief,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseJsonSchema: RESPONSE_SCHEMA,
          temperature: 0.4, // Some warmth in phrasing; the facts are fixed.
        },
      }),
      COMPOSE_TIMEOUT_MS,
      "Composition"
    );

    const raw = response.text;
    if (!raw) throw new Error("Composition returned an empty response");

    return ComposedResponse.parse(JSON.parse(raw));
  } catch (err) {
    throw classifyError(err);
  }
}

/**
 * Deterministic fallback copy, used when the writer is unavailable but a
 * decision exists.
 *
 * Because adjudication is pure and never depends on the API, a quota failure
 * costs the system its prose, not its answer. The customer still gets a
 * correct and complete outcome.
 */
export function composeFallback(
  decision: Decision,
  order: OrderContext
): ComposedResponse {
  const outcome = describeOutcome(decision);

  return {
    customer_message: `Hi — thanks for sending the photo of your ${order.item_name}.\n\nWe've reviewed your claim (order ${order.order_id}) and here's the outcome: ${outcome}\n\n${decision.reason}\n\nIf anything here doesn't look right, just reply to this message and we'll take another look.`,
    ticket_subject: `${decision.action.toUpperCase()} — ${order.item_name} (${order.order_id})`,
    internal_summary: `Auto-resolved under policy ${decision.policy_version}. ${decision.reason}`,
  };
}
