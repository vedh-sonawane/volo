// The built-in, zero-dependency degraded provider.
//
// It is intentionally "unavailable" as a text generator: it never fabricates
// prose. This forces the engine to use its deterministic templates and honest
// rule-based logic, which is exactly what we want when no AI is configured.
// Volo is fully functional with only this provider.

import type { GenerateOptions, ModelProvider } from "./types";

export class RuleModelProvider implements ModelProvider {
  readonly name = "rule";

  async available(): Promise<boolean> {
    return false;
  }

  async generate(_prompt: string, _opts?: GenerateOptions): Promise<string | null> {
    return null;
  }
}
