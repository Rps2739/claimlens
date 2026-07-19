import { NextResponse } from "next/server";
import { adjudicate } from "@/lib/adjudicate";
import { compose, composeFallback } from "@/lib/compose";
import { QuotaError, hasApiKey } from "@/lib/gemini";
import { perceive } from "@/lib/perceive";
import { getOrder } from "@/lib/orders";
import { budgetRemaining, checkRateLimit, clientIp } from "@/lib/ratelimit";
import { getSample } from "@/lib/samples";
import { ResolveRequest } from "@/lib/types";
import type { ComposedResponse, PerceptionResult, ResolveResponse } from "@/lib/types";

export const runtime = "nodejs";
/** Claims are assessed per-request; nothing here is cacheable. */
export const dynamic = "force-dynamic";

/**
 * POST /api/resolve — the pipeline orchestrator.
 *
 * This is the only module that holds the API key, and the only one that knows
 * about degradation. The four stages stay unaware of each other and of whether
 * the system is running live or from cache.
 *
 * DEGRADATION POLICY
 * ------------------
 * The free Gemini tier allows roughly 250 requests/day, so a reviewer arriving
 * after the quota is spent is a realistic event, not an edge case. Rather than
 * showing them a broken page, the pipeline degrades in stages:
 *
 *   perception unavailable  + bundled sample → replay the cached perception
 *   perception unavailable  + user upload    → 503 with an honest explanation
 *   composition unavailable + any claim      → deterministic template copy
 *
 * Adjudication has no degraded mode because it never depends on the network.
 * That is the practical payoff of keeping the decision layer pure: the system
 * can lose its eyes and its voice and still produce a correct outcome.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = ResolveRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { image_base64, image_mime_type, description, order_id, sample_id } = parsed.data;
  const sample = sample_id ? getSample(sample_id) : undefined;

  if (sample_id && !sample) {
    return NextResponse.json({ error: `Unknown sample "${sample_id}".` }, { status: 404 });
  }

  // The trusted half of the input. Resolved here, on the server, from an ID —
  // never taken from the request body. This is the line that makes "the
  // customer never controls the money" true at the API level and not merely
  // in the UI. `item_value` feeds the payout calculation directly, so a
  // caller-supplied value would let anyone name their own refund.
  const order = getOrder(order_id);
  if (!order) {
    return NextResponse.json({ error: `Unknown order "${order_id}".` }, { status: 404 });
  }

  const timings = { perceive: 0, adjudicate: 0, compose: 0 };
  let source: ResolveResponse["source"] = "live";
  let fallback_reason: string | undefined;

  // ---- STAGE 2: PERCEIVE -------------------------------------------------
  let perception: PerceptionResult;
  const t0 = Date.now();

  if (sample) {
    // Bundled samples always replay their cached, deterministic analysis —
    // with or without a live key. They exist precisely so the primary
    // demo path never depends on network availability or quota. Only a
    // genuine photo upload (handled below) ever calls Gemini live.
    perception = sample.cachedPerception;
    source = "cached";
    fallback_reason = hasApiKey()
      ? undefined
      : "No API key is configured, so this sample replays a cached analysis.";
    timings.perceive = Date.now() - t0;
  } else if (!hasApiKey()) {
    return NextResponse.json(
      {
        error: "no_api_key",
        message:
          "Analysing your own photo needs a Gemini API key on the server. The four sample claims below work without one.",
      },
      { status: 503 }
    );
  } else {
    try {
      if (!image_base64 || !image_mime_type) {
        return NextResponse.json(
          { error: "An image is required to assess a claim." },
          { status: 400 }
        );
      }

      // Rate limiting applies here and nowhere else: this is the only branch
      // that spends quota. Sample replays above are free and stay unlimited,
      // so throttling an abuser never degrades the demo for a reviewer.
      const limit = checkRateLimit(clientIp(req));
      if (!limit.allowed) {
        return NextResponse.json(
          { error: "rate_limited", message: limit.reason },
          {
            status: 429,
            headers: limit.retryAfterSeconds
              ? { "Retry-After": String(limit.retryAfterSeconds) }
              : undefined,
          }
        );
      }

      perception = await perceive(image_base64, image_mime_type, description);
      timings.perceive = Date.now() - t0;
    } catch (err) {
      timings.perceive = Date.now() - t0;

      // This branch only ever runs for a genuine photo upload — sample
      // requests are fully handled above and never reach here — so there is
      // no cached fallback available; report the failure honestly.
      const quota = err instanceof QuotaError;
      return NextResponse.json(
        {
          error: quota ? "quota_exceeded" : "perception_failed",
          message: quota
            ? "The daily free-tier quota for image analysis is used up. The four sample claims below still work — they replay cached analyses."
            : `Could not analyse that image: ${
                err instanceof Error ? err.message : "unknown error"
              }. The sample claims below still work.`,
        },
        { status: quota ? 429 : 502 }
      );
    }
  }

  // ---- STAGE 3: ADJUDICATE ----------------------------------------------
  // Always runs live. Pure, free, and never skipped — the outcome a reviewer
  // sees is computed from policy.json even when the AI stages are cached.
  const t1 = Date.now();
  const decision = adjudicate(perception, order);
  timings.adjudicate = Date.now() - t1;

  // ---- STAGE 4: COMPOSE --------------------------------------------------
  let composed: ComposedResponse;
  const t2 = Date.now();

  if (source === "cached" && sample) {
    composed = sample.cachedComposed;
    timings.compose = Date.now() - t2;
  } else {
    try {
      composed = await compose(decision, perception, order);
      timings.compose = Date.now() - t2;
    } catch (err) {
      // The decision stands; only the prose falls back to a template.
      composed = composeFallback(decision, order);
      timings.compose = Date.now() - t2;
      source = "cached";
      fallback_reason = `The message writer was unavailable (${
        err instanceof Error ? err.message : "unknown error"
      }), so this message uses a template. The decision above is unaffected.`;
    }
  }

  const response: ResolveResponse = {
    perception,
    decision,
    composed,
    source,
    fallback_reason,
    timings_ms: timings,
  };

  return NextResponse.json(response);
}

/** Lets the UI show demo-mode state before anyone submits a claim. */
export async function GET() {
  const live = hasApiKey();
  const remaining = budgetRemaining();

  return NextResponse.json({
    live: live && remaining > 0,
    budget_remaining: live ? remaining : null,
    message: !live
      ? "Running in demo mode: sample claims replay cached analyses. Decisions are still computed live."
      : remaining > 0
        ? "Live analysis is available."
        : "Daily live-analysis budget is spent. Sample claims still work.",
  });
}
