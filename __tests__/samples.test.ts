import { describe, expect, it } from "vitest";
import { adjudicate, policy } from "../lib/adjudicate";
import { SAMPLES } from "../lib/samples";
import { PerceptionResult } from "../lib/types";

/**
 * The bundled samples are what a reviewer actually clicks, so what they
 * demonstrate is worth pinning down.
 *
 * These tests run the cached perceptions through the real engine. If someone
 * edits policy.json and a sample stops showing the rule it was chosen to
 * illustrate, this fails rather than the demo quietly becoming less
 * interesting.
 */

describe("bundled sample cases", () => {
  it("every cached perception satisfies the schema", () => {
    // Cached data has to clear the same validation gate as live model output.
    for (const s of SAMPLES) {
      expect(() => PerceptionResult.parse(s.cachedPerception), s.id).not.toThrow();
    }
  });

  it("each sample exercises a distinct rule", () => {
    const deciding = SAMPLES.map((s) => {
      const d = adjudicate(s.cachedPerception, s.order);
      return d.rules_fired[d.rules_fired.length - 1].id;
    });

    expect(new Set(deciding).size).toBe(SAMPLES.length);
  });

  it("resolves the mug claim with a full automatic refund", () => {
    const s = SAMPLES.find((x) => x.id === "mug")!;
    const d = adjudicate(s.cachedPerception, s.order);

    expect(d.action).toBe("refund");
    expect(d.amount).toBe(899);
    expect(d.requires_human).toBe(false);
  });

  it("holds the high-value phone claim for a human despite clear evidence", () => {
    const s = SAMPLES.find((x) => x.id === "phone")!;
    const d = adjudicate(s.cachedPerception, s.order);

    // Severity 5 and 96% confidence would refund on a cheaper item. Value is
    // the only reason this stops — that distinction is the point of the demo.
    expect(s.cachedPerception.severity).toBe(5);
    expect(d.action).toBe("escalate");
    expect(d.requires_human).toBe(true);
    expect(d.amount).toBe(0);
  });

  it("replaces the wrong item even though nothing is damaged", () => {
    const s = SAMPLES.find((x) => x.id === "shirt")!;
    const d = adjudicate(s.cachedPerception, s.order);

    expect(s.cachedPerception.severity).toBe(1);
    expect(d.action).toBe("replace");
  });

  it("declines to assess the unusable photo and routes it to a human", () => {
    const s = SAMPLES.find((x) => x.id === "blurry")!;
    const d = adjudicate(s.cachedPerception, s.order);

    expect(d.action).toBe("escalate");
    expect(d.requires_human).toBe(true);
    expect(d.amount).toBe(0);
  });

  it("changes what the samples decide when the policy file changes", () => {
    // Substantiates the central claim: outcomes come from policy.json, not
    // from the model. Raising the ceiling above the phone's value should flip
    // it from escalation to an automatic refund, with no AI involved.
    const s = SAMPLES.find((x) => x.id === "phone")!;

    const strict = adjudicate(s.cachedPerception, s.order);
    expect(strict.action).toBe("escalate");

    const generous = adjudicate(s.cachedPerception, s.order, {
      ...policy,
      auto_approve_ceiling: 100000,
    });
    expect(generous.action).toBe("refund");
    expect(generous.amount).toBe(64999);
  });

  it("never pays out on a claim that requires human review", () => {
    for (const s of SAMPLES) {
      const d = adjudicate(s.cachedPerception, s.order);
      if (d.requires_human) expect(d.amount, s.id).toBe(0);
    }
  });

  it("keeps cached copy consistent with the live decision", () => {
    // Guards against the cached message promising something the engine no
    // longer decides — the failure mode that would embarrass us in demo mode.
    for (const s of SAMPLES) {
      const d = adjudicate(s.cachedPerception, s.order);
      const subject = s.cachedComposed.ticket_subject.toLowerCase();

      const expected: Record<string, string> = {
        refund: "refund",
        replace: "replacement",
        escalate: "escalated",
        reject: "declined",
      };
      expect(subject, `${s.id} subject vs ${d.action}`).toContain(expected[d.action]);

      // A message for a zero-payout outcome must not quote a rupee figure.
      if (d.amount === 0) {
        expect(s.cachedComposed.customer_message, s.id).not.toMatch(/₹\s?\d/);
      }
    }
  });
});
