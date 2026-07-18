import "server-only";

/**
 * Abuse protection for the only endpoint that spends money.
 *
 * THREAT MODEL
 * ------------
 * `/api/resolve` is public and unauthenticated, which is correct for a demo a
 * stranger must be able to use. The exposure that creates is quota theft: a
 * script that POSTs images in a loop drains the daily Gemini allowance, and a
 * reviewer arriving afterwards finds a degraded app.
 *
 * Note what is NOT at risk. The key never leaves the server, so it cannot be
 * extracted and reused elsewhere — an attacker can only ever spend quota
 * through this endpoint, at a rate this file controls.
 *
 * Two independent limits:
 *
 *   1. Per-IP    — stops one client from monopolising the endpoint.
 *   2. Global    — caps total daily spend below the free-tier ceiling, so
 *                  even a distributed flood cannot exhaust the allowance.
 *
 * Only requests that actually call Gemini are counted. Bundled samples in
 * demo mode cost nothing and are never limited, which is what keeps the demo
 * working for honest reviewers even while an abuser is being throttled.
 *
 * LIMITATION, STATED PLAINLY
 * --------------------------
 * This is in-memory. On serverless it is per-instance and resets on cold
 * start, so it raises the cost of abuse rather than making it impossible.
 * Production would use Redis (Upstash) for a shared counter. For a demo whose
 * worst case is a spent free-tier quota and a graceful fallback, the tradeoff
 * is deliberate — a database dependency would add more failure modes than it
 * removes.
 */

/** Live analyses one IP may run in a rolling window. */
const PER_IP_LIMIT = 5;
const PER_IP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Ceiling on live analyses per UTC day across all callers.
 * Free tier is ~250/day; stopping at 200 keeps headroom so the owner can
 * still demo the live path after an abuse spike.
 */
const GLOBAL_DAILY_LIMIT = 200;

const ipHits = new Map<string, number[]>();
let globalCount = 0;
let globalDay = utcDay();

function utcDay(): number {
  return Math.floor(Date.now() / 86_400_000);
}

/** Drop IP entries with no recent activity so the map cannot grow unbounded. */
function sweep(now: number) {
  if (ipHits.size < 500) return;
  for (const [ip, hits] of ipHits) {
    const live = hits.filter((t) => now - t < PER_IP_WINDOW_MS);
    if (live.length === 0) ipHits.delete(ip);
    else ipHits.set(ip, live);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Safe to show a caller: explains the limit without leaking internals. */
  reason?: string;
  retryAfterSeconds?: number;
}

/**
 * Record and evaluate one billable request.
 *
 * Call this ONLY for requests about to hit the Gemini API. Cached and sample
 * requests must not be passed here.
 */
export function checkRateLimit(ip: string): RateLimitResult {
  const now = Date.now();

  // Reset the global counter when the UTC day rolls over.
  const today = utcDay();
  if (today !== globalDay) {
    globalDay = today;
    globalCount = 0;
  }

  if (globalCount >= GLOBAL_DAILY_LIMIT) {
    const secondsToMidnight = 86_400 - Math.floor((now % 86_400_000) / 1000);
    return {
      allowed: false,
      reason:
        "This demo's daily budget for live image analysis is used up. The four sample claims still work — they replay cached analyses and cost nothing.",
      retryAfterSeconds: secondsToMidnight,
    };
  }

  sweep(now);

  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < PER_IP_WINDOW_MS);

  if (hits.length >= PER_IP_LIMIT) {
    const oldest = Math.min(...hits);
    return {
      allowed: false,
      reason: `Rate limit: ${PER_IP_LIMIT} live analyses per ${
        PER_IP_WINDOW_MS / 60_000
      } minutes. The sample claims below are unlimited.`,
      retryAfterSeconds: Math.ceil((PER_IP_WINDOW_MS - (now - oldest)) / 1000),
    };
  }

  hits.push(now);
  ipHits.set(ip, hits);
  globalCount++;

  return { allowed: true };
}

/**
 * Best-effort client identity.
 *
 * `x-forwarded-for` is client-controllable in general, but on Vercel and
 * Render the platform proxy overwrites it, so the leftmost entry is
 * trustworthy there. Unknown callers share one bucket, which fails closed:
 * spoofers get throttled together rather than each getting a fresh quota.
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Exposed for the status endpoint so the UI can show remaining budget. */
export function budgetRemaining(): number {
  if (utcDay() !== globalDay) return GLOBAL_DAILY_LIMIT;
  return Math.max(0, GLOBAL_DAILY_LIMIT - globalCount);
}
