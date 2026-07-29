// Model provider factory + resolver.
//
// Resolves the configured provider, but ALWAYS guarantees a working engine:
// if the preferred provider is unavailable at runtime, resolveModel() returns
// the rule-based provider so the app runs in honest degraded mode.

import type { ModelProvider } from "./types";
import { RuleModelProvider } from "./rule";
import { OllamaModelProvider } from "./ollama";
import { cfg } from "@/lib/config";

export type { ModelProvider, GenerateOptions, ModelCapability } from "./types";
export { modelCapabilities, GENERATIVE_CAPABILITIES } from "./types";

const rule = new RuleModelProvider();

/** The deterministic provider — used when a fast, network-free path is required. */
export function ruleModel(): ModelProvider {
  return rule;
}

function configured(): ModelProvider {
  const choice = cfg("MODEL_PROVIDER", "rule").toLowerCase();
  switch (choice) {
    case "ollama":
      return new OllamaModelProvider();
    case "rule":
    default:
      return rule;
  }
}

/**
 * Returns the provider that will actually run this request. Tries the configured
 * provider; if it can't run, falls back to the deterministic rule provider.
 */
export async function resolveModel(): Promise<ModelProvider> {
  const preferred = configured();
  if (preferred.name === "rule") return rule;
  const ok = await preferred.available();
  return ok ? preferred : rule;
}
