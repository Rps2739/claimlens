import { getOrder } from "./orders";
import type { ComposedResponse, OrderContext, PerceptionResult } from "./types";

/**
 * Read an order from the order system.
 *
 * Samples reference orders by ID rather than restating item names and prices,
 * so the demo cannot drift out of sync with the records the server actually
 * adjudicates against. Throws at module load if an ID is wrong, which turns a
 * typo into an immediate startup failure rather than a silently wrong payout.
 */
function order(orderId: string): OrderContext {
  const found = getOrder(orderId);
  if (!found) throw new Error(`Sample references unknown order "${orderId}"`);
  return found;
}

/**
 * The four bundled demo claims.
 *
 * Each one deliberately exercises a different branch of the policy ladder, so
 * clicking through all four walks a reviewer down the entire decision surface:
 *
 *   mug     → R8  full refund        (clean automatic resolution)
 *   phone   → R7  high-value escalate (spend ceiling protects the business)
 *   shirt   → R6  replacement         (fulfilment error, severity irrelevant)
 *   blurry  → R1  ambiguous escalate  (the system declining to guess)
 *
 * WHAT IS CACHED, AND WHAT IS NOT
 * -------------------------------
 * Only the two model calls are cached: the perception and the written message.
 * The decision itself is NEVER cached — `adjudicate()` runs live on every
 * request, including in demo mode, because it is pure and costs nothing.
 *
 * So even with no API key configured, the outcome a reviewer sees was computed
 * by the real engine from the real policy file. Editing `policy.json` changes
 * what the bundled samples decide. Demo mode replays the AI, not the answer.
 */

export interface SampleCase {
  id: string;
  label: string;
  /** What the reviewer should notice about this case. */
  teaser: string;
  image: string;
  description: string;
  order: OrderContext;
  cachedPerception: PerceptionResult;
  cachedComposed: ComposedResponse;
}

export const SAMPLES: SampleCase[] = [
  {
    id: "mug",
    label: "Broken mug",
    teaser: "Clear damage, low value → resolves automatically",
    image: "/samples/mug-broken.svg",
    description:
      "The box was crushed when it arrived and the mug inside is in pieces.",
    order: order("ORD-2291"),
    cachedPerception: {
      item_type: "ceramic coffee mug",
      damage_type: "physical_damage",
      severity: 4,
      visible_evidence: [
        "mug body fractured into several separate pieces",
        "handle fully detached from the body",
        "shipping carton visibly crushed along the front panel",
        "ceramic dust and small fragments scattered around the base",
      ],
      confidence: 0.94,
      is_ambiguous: false,
      notes:
        "Item is broken into multiple pieces and cannot be used. Damage is consistent with crush force applied to the carton in transit.",
    },
    cachedComposed: {
      customer_message:
        "Your refund of ₹899 is on its way back to your original payment method — you should see it within 5-7 business days.\n\nThe photo made it clear: the mug arrived in several pieces with the handle snapped off, and the carton was crushed along the front. That happened in transit, not on your end. There's nothing you need to send back — please recycle the pieces safely.\n\nSorry this one didn't make it to you in one piece. If the refund hasn't landed by the end of next week, just reply here and we'll chase it.",
      ticket_subject: "REFUND ₹899 — Stoneware Coffee Mug (ORD-2291)",
      internal_summary:
        "Transit crush damage, severity 4/5, auto-refunded in full under policy 1.0.0. No return required.",
    },
  },

  {
    id: "phone",
    label: "Shattered phone",
    teaser: "Severe damage, but high value → held for human approval",
    image: "/samples/phone-cracked.svg",
    description:
      "Screen was already shattered when I opened the box. I never even powered it on.",
    order: order("ORD-8834"),
    cachedPerception: {
      item_type: "smartphone",
      damage_type: "cracked_screen",
      severity: 5,
      visible_evidence: [
        "spiderweb fracture radiating from a single impact point left of centre",
        "concentric stress rings across the full display",
        "glass fragment lifted and separated near the lower right edge",
        "dark band across the lower display consistent with panel failure",
      ],
      confidence: 0.96,
      is_ambiguous: false,
      notes:
        "Display is comprehensively shattered with likely panel damage beneath the glass. Device is not usable in this condition.",
    },
    cachedComposed: {
      customer_message:
        "Your claim is with one of our specialists now, and they'll be in touch within 24 hours.\n\nWe can see the damage clearly — the screen has a full spiderweb fracture from a single impact point, and there's panel damage under the glass. That's not something you did.\n\nBecause of the value of this device, our policy is that a person signs off on the remedy rather than an automated system. That's the only reason for the short wait. You don't need to do anything else in the meantime.",
      ticket_subject: "ESCALATED — Aurora X9 Smartphone, ₹64,999 (ORD-8834)",
      internal_summary:
        "Severity 5/5 screen failure, evidence unambiguous. Escalated on value ceiling (₹64,999 > ₹15,000), not on doubt. Recommend fast approval.",
    },
  },

  {
    id: "shirt",
    label: "Wrong item",
    teaser: "Undamaged, but not what was ordered → replacement",
    image: "/samples/wrong-item.svg",
    description:
      "I ordered a navy polo in medium and a red one in large turned up instead.",
    order: order("ORD-4417"),
    cachedPerception: {
      item_type: "polo shirt",
      damage_type: "wrong_item",
      severity: 1,
      visible_evidence: [
        "shirt in the package is red; the order label reads navy",
        "size tag reads L, the shipping label specifies M",
        "garment itself shows no damage, staining, or wear",
        "shipping label ORD-4417 legible on the mailer",
      ],
      confidence: 0.93,
      is_ambiguous: false,
      notes:
        "Garment is in perfect condition but matches neither the colour nor the size on the order label. Fulfilment error rather than a damage claim.",
    },
    cachedComposed: {
      customer_message:
        "The right shirt — navy, medium — is shipping to you today at no cost.\n\nYou're right that we got this wrong. The package contained a red polo in large, and your order was for navy in medium. That's a picking error in our warehouse.\n\nKeep the red one or pass it on to someone who'd like it; we're not asking you to post it back. Your replacement should arrive in 3-4 days and you'll get tracking by email shortly.",
      ticket_subject: "REPLACEMENT — Navy Polo M sent in error (ORD-4417)",
      internal_summary:
        "Fulfilment error: red/L shipped against navy/M order. Item undamaged. Replacement dispatched, no return requested. Flag to warehouse QA.",
    },
  },

  {
    id: "blurry",
    label: "Unusable photo",
    teaser: "The system refuses to guess → routed to a human",
    image: "/samples/blurry-unclear.svg",
    description: "it broke, look at the photo, i want my money back",
    order: order("ORD-6120"),
    cachedPerception: {
      item_type: "unidentifiable object",
      damage_type: "unclear",
      severity: 1,
      visible_evidence: [
        "severe motion blur across the entire frame",
        "underexposed, no subject edges resolve",
        "blown-out light source behind the subject obscuring detail",
        "no product form identifiable with any confidence",
      ],
      confidence: 0.18,
      is_ambiguous: true,
      notes:
        "The photograph does not resolve into any identifiable item. No assessment of damage is possible from this image.",
    },
    cachedComposed: {
      customer_message:
        "A member of our support team is picking up your claim personally and will reply within 24 hours.\n\nWe had a look at the photo, but it came out too blurry and dark for us to make out the lamp or any damage to it. Rather than guess at something that affects your refund, we'd rather a person looked at it properly.\n\nIf you're able to send another photo in better light — the whole lamp in frame, camera steady — it'll speed things up a lot. Either way, we'll come back to you tomorrow.",
      ticket_subject: "ESCALATED — unusable claim photo, Table Lamp (ORD-6120)",
      internal_summary:
        "Vision confidence 0.18, image ambiguous. No automated assessment attempted. Needs a human and likely a re-request of the photo.",
    },
  },
];

export function getSample(id: string): SampleCase | undefined {
  return SAMPLES.find((s) => s.id === id);
}
