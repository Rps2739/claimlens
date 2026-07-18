import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the abuse limiter.
 *
 * The module holds counters in module scope, so each test resets it with
 * `vi.resetModules()` and a fresh dynamic import rather than sharing state.
 */

async function freshLimiter() {
  vi.resetModules();
  return await import("../lib/ratelimit");
}

const req = (headers: Record<string, string>) =>
  new Request("http://localhost/api/resolve", { headers });

describe("per-IP limiting", () => {
  beforeEach(() => vi.useRealTimers());

  it("allows requests up to the per-IP limit", async () => {
    const { checkRateLimit } = await freshLimiter();

    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("1.2.3.4").allowed, `request ${i + 1}`).toBe(true);
    }
  });

  it("blocks the request after the limit and explains why", async () => {
    const { checkRateLimit } = await freshLimiter();

    for (let i = 0; i < 5; i++) checkRateLimit("1.2.3.4");
    const blocked = checkRateLimit("1.2.3.4");

    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toMatch(/sample claims/i);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("does not let one abuser affect a different client", async () => {
    const { checkRateLimit } = await freshLimiter();

    for (let i = 0; i < 6; i++) checkRateLimit("9.9.9.9");

    expect(checkRateLimit("9.9.9.9").allowed).toBe(false);
    expect(checkRateLimit("5.5.5.5").allowed).toBe(true);
  });

  it("lets a blocked client back in once the window passes", async () => {
    vi.useFakeTimers();
    const { checkRateLimit } = await freshLimiter();

    for (let i = 0; i < 5; i++) checkRateLimit("7.7.7.7");
    expect(checkRateLimit("7.7.7.7").allowed).toBe(false);

    vi.advanceTimersByTime(10 * 60 * 1000 + 1000);
    expect(checkRateLimit("7.7.7.7").allowed).toBe(true);

    vi.useRealTimers();
  });
});

describe("global daily budget", () => {
  it("caps total spend below the free-tier ceiling even across many IPs", async () => {
    const { checkRateLimit, budgetRemaining } = await freshLimiter();

    let allowed = 0;
    // 400 distinct IPs, each within its own per-IP allowance. Only the global
    // cap can stop this — which is the distributed-abuse case.
    for (let ip = 0; ip < 400; ip++) {
      for (let n = 0; n < 3; n++) {
        if (checkRateLimit(`10.0.${Math.floor(ip / 256)}.${ip % 256}`).allowed) allowed++;
      }
    }

    expect(allowed).toBe(200);
    expect(budgetRemaining()).toBe(0);

    const next = checkRateLimit("203.0.113.9");
    expect(next.allowed).toBe(false);
    expect(next.reason).toMatch(/daily budget/i);
  });

  it("stays under the 250/day free-tier limit with headroom to spare", async () => {
    const { checkRateLimit } = await freshLimiter();

    let allowed = 0;
    for (let ip = 0; ip < 1000; ip++) {
      if (checkRateLimit(`172.16.${Math.floor(ip / 256)}.${ip % 256}`).allowed) allowed++;
    }

    expect(allowed).toBeLessThanOrEqual(200);
    expect(allowed).toBeLessThan(250); // never exhausts the real quota
  });
});

describe("client identification", () => {
  it("reads the leftmost x-forwarded-for entry", async () => {
    const { clientIp } = await freshLimiter();

    expect(clientIp(req({ "x-forwarded-for": "203.0.113.5, 70.41.3.18" }))).toBe(
      "203.0.113.5"
    );
  });

  it("falls back to x-real-ip", async () => {
    const { clientIp } = await freshLimiter();

    expect(clientIp(req({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
  });

  it("fails closed by bucketing unidentifiable callers together", async () => {
    const { clientIp, checkRateLimit } = await freshLimiter();

    expect(clientIp(req({}))).toBe("unknown");

    // Shared bucket means header-strippers throttle each other rather than
    // each receiving a fresh allowance.
    for (let i = 0; i < 5; i++) checkRateLimit(clientIp(req({})));
    expect(checkRateLimit(clientIp(req({}))).allowed).toBe(false);
  });
});
