// ─────────────────────────────────────────────────────────────────────────────
// Per-request user context.
//
// Multi-tenancy without threading a userId through every function: an
// AsyncLocalStorage holds the current request's user. The store and config layer
// read `currentUserId()` to scope EVERY read/write, so no data can leak between
// accounts. better-sqlite3 is synchronous, so the context is stable across the
// sync DB calls; AsyncLocalStorage also survives `await`s during a task run.
//
// When there is no request context (tests, CLI, the very first boot before any
// account exists) we fall back to a single DEFAULT_USER — preserving the original
// single-user local behavior exactly.
// ─────────────────────────────────────────────────────────────────────────────

import { AsyncLocalStorage } from "node:async_hooks";

/** The scope used when no authenticated user is present (legacy/local/tests). */
export const DEFAULT_USER = "local";

const als = new AsyncLocalStorage<{ userId: string }>();

/** Run `fn` with the given user as the current data scope. */
export function runWithUser<T>(userId: string, fn: () => T): T {
  return als.run({ userId: userId || DEFAULT_USER }, fn);
}

/** The current data scope — an authenticated user, or DEFAULT_USER. */
export function currentUserId(): string {
  return als.getStore()?.userId ?? DEFAULT_USER;
}
