/**
 * Test-time stub for the `server-only` package.
 *
 * The real package throws on import outside a React Server Component, which
 * is exactly the protection we want in the build — it turns "a client
 * component imported the module holding the API key" into a build failure.
 *
 * Vitest runs plain Node with no RSC context, so importing the real package
 * would fail for the wrong reason. This stub is aliased in vitest.config.ts
 * so tests can exercise server modules directly while production keeps the
 * real guard.
 */
export {};
