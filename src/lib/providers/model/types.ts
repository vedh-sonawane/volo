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

/**
 * The distinct things a model provider can do. A GENERATIVE model (Ollama, or any
 * future LLM) supports ALL of these; a deterministic rule provider supports none
 * of the free-text ones. Capability detection derives from this single source of
 * truth — never from provider-specific special-casing — so a connected model
 * always exposes every capability it can genuinely perform.
 */
export type ModelCapability = "planning" | "clarification" | "direct_answer" | "generation";

export const GENERATIVE_CAPABILITIES: ModelCapability[] = ["planning", "clarification", "direct_answer", "generation"];

export interface ModelProvider {
  readonly name: string;
  /**
   * True when this provider can compose original free-form text (answers, drafts,
   * summaries, plans in prose). A deterministic rule provider is NOT generative.
   * This is what makes direct_answer / writing / clarification available.
   */
  readonly generative: boolean;
  /** Whether the provider can actually run right now (e.g. Ollama reachable). */
  available(): Promise<boolean>;
  /**
   * Produce text for a prompt. Returns null when the provider is unavailable or
   * cannot answer — callers MUST handle null with a deterministic fallback.
   */
  generate(prompt: string, opts?: GenerateOptions): Promise<string | null>;
}

/** The capabilities a provider can genuinely perform (generic, not provider-specific). */
export function modelCapabilities(m: Pick<ModelProvider, "generative">): ModelCapability[] {
  return m.generative ? [...GENERATIVE_CAPABILITIES] : [];
}
