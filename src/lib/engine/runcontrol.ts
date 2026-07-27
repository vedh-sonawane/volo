// ─────────────────────────────────────────────────────────────────────────────
// Cooperative run control (cancel / supersede).
//
// Each analysis run for a task captures a "generation" number. Cancelling an
// objective, or editing its prompt (which restarts analysis), bumps the task's
// generation. A run whose captured generation is no longer current is
// "superseded": the executor stops advancing it and — critically — refuses to
// persist anything, so an in-flight run can NEVER resurrect a task the user just
// cancelled/erased, and a stale run can never clobber a fresh one.
//
// This lives in its own module so both the runner and the executor can import it
// without a circular dependency.
// ─────────────────────────────────────────────────────────────────────────────

const generation = new Map<string, number>();

/** Bump a task's generation, superseding any in-flight run. Returns the new gen. */
export function bumpGeneration(id: string): number {
  const next = (generation.get(id) ?? 0) + 1;
  generation.set(id, next);
  return next;
}

/** The current (latest) generation for a task. */
export function currentGeneration(id: string): number {
  return generation.get(id) ?? 0;
}

/** True when `myGen` is no longer the current generation (this run was superseded). */
export function isSuperseded(id: string, myGen: number): boolean {
  return generation.get(id) !== myGen;
}
