import "server-only";
import { GoogleGenAI } from "@google/genai";

/**
 * Single point of contact with the Gemini API.
 *
 * The `server-only` import at the top is load-bearing: if any client
 * component ever imports this module (directly or transitively), the build
 * fails rather than shipping the key to the browser. It converts a silent
 * credential leak into a compile error.
 */

export const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

/** Raised when no key is configured, so callers can fall back to cache. */
export class MissingKeyError extends Error {
  constructor() {
    super("GEMINI_API_KEY is not set");
    this.name = "MissingKeyError";
  }
}

/** Raised on quota exhaustion (HTTP 429) — expected on the free tier. */
export class QuotaError extends Error {
  constructor(message = "Gemini API quota exceeded") {
    super(message);
    this.name = "QuotaError";
  }
}

export function hasApiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

let client: GoogleGenAI | null = null;

export function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new MissingKeyError();

  // Cached across invocations in the same warm serverless instance.
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

/**
 * Normalise the many shapes an API failure can take into our two typed
 * errors, so the orchestrator can branch on cause rather than string-match.
 */
export function classifyError(err: unknown): Error {
  if (err instanceof MissingKeyError || err instanceof QuotaError) return err;

  const message = err instanceof Error ? err.message : String(err);

  if (/\b429\b|quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(message)) {
    return new QuotaError(message);
  }
  return err instanceof Error ? err : new Error(message);
}

/**
 * Fail fast rather than leaving a judge watching a spinner.
 *
 * A serverless function that hangs looks identical to a broken deployment
 * from the outside, so an unresponsive model is treated as a failure and
 * routed to the cached path.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
