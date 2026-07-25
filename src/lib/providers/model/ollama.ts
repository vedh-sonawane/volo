// Optional local open-source model provider via Ollama (https://ollama.com).
//
// 100% free and local — no API key, no account, no credit card. Only used when
// MODEL_PROVIDER=ollama. If Ollama isn't running, available() returns false and
// the engine transparently falls back to rule-based behavior.

import type { GenerateOptions, ModelProvider } from "./types";

export class OllamaModelProvider implements ModelProvider {
  readonly name = "ollama";
  private baseUrl: string;
  private model: string;

  constructor() {
    this.baseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
    this.model = process.env.OLLAMA_MODEL || "llama3.2";
  }

  async available(): Promise<boolean> {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: ctrl.signal });
      clearTimeout(t);
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(prompt: string, opts: GenerateOptions = {}): Promise<string | null> {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 60_000);
      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: this.model,
          prompt,
          system: opts.system,
          stream: false,
          format: opts.json ? "json" : undefined,
          options: {
            temperature: opts.temperature ?? 0.2,
            num_predict: opts.maxTokens ?? 512,
          },
        }),
      });
      clearTimeout(t);
      if (!res.ok) return null;
      const data = (await res.json()) as { response?: string };
      return data.response?.trim() || null;
    } catch {
      return null;
    }
  }
}
