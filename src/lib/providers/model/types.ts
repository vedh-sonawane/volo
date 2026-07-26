// ─────────────────────────────────────────────────────────────────────────────
// ModelProvider abstraction (Phase 5).
//
// The application must NOT be hardcoded to one model provider. The interface is
// deliberately minimal — a single `generate` primitive — so that:
//   • the rule-based provider can honestly report itself unavailable, and
//   • a local (Ollama) or future paid provider can be dropped in unchanged.
//
// Crucially, the engine NEVER requires a model to function. Every place that
// calls a model has a deterministic fallback (see lib/engine/llm.ts). A null
// return means "no model produced this" — the engine then uses rules.
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerateOptions {
  system?: string;
  /** Ask the provider to return strict JSON (best-effort). */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Override the provider's default request timeout (ms) for this call. */
  timeoutMs?: number;
}

export interface ModelProvider {
  readonly name: string;
  /** Whether the provider can actually run right now (e.g. Ollama reachable). */
  available(): Promise<boolean>;
  /**
   * Produce text for a prompt. Returns null when the provider is unavailable or
   * cannot answer — callers MUST handle null with a deterministic fallback.
   */
  generate(prompt: string, opts?: GenerateOptions): Promise<string | null>;
}
