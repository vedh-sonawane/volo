// Optional local open-source model provider via Ollama (https://ollama.com).
//
// 100% free and local — no API key, no account, no credit card. Only used when
// MODEL_PROVIDER=ollama. If Ollama isn't running, available() returns false and
// the engine transparently falls back to rule-based behavior.

import type { GenerateOptions, ModelProvider } from "./types";
import { cfg } from "@/lib/config";

export class OllamaModelProvider implements ModelProvider {
  readonly name = "ollama";
  private static warned = false;
  private baseUrl: string;
  private model: string;

  constructor() {
    this.baseUrl = cfg("OLLAMA_BASE_URL", "http://127.0.0.1:11434");
    this.model = cfg("OLLAMA_MODEL", "llama3.2");
  }

  async available(): Promise<boolean> {
    // "Available" means BOTH the server responds AND the configured model is
    // actually installed. Checking only the server (as before) let a misconfig
    // silently fall through: the UI would say "model: ollama" while every
    // generate() failed with "model not found". Verify the model exists.
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return false;
      const data = (await res.json()) as { models?: { name: string }[] };
      const installed = (data.models ?? []).map((m) => m.name);
      const wantBase = this.model.split(":")[0];
      const ok = installed.some(
        (n) => n === this.model || n === `${this.model}:latest` || n.split(":")[0] === wantBase
      );
      if (!ok && !OllamaModelProvider.warned) {
        OllamaModelProvider.warned = true;
        console.warn(
          `[volo] OLLAMA_MODEL="${this.model}" is not installed. Available: ` +
            `${installed.join(", ") || "(none)"}. Run \`ollama pull ${this.model}\` or set ` +
            `OLLAMA_MODEL to one of the installed models. Falling back to the deterministic engine.`
        );
      }
      return ok;
    } catch {
      return false;
    }
  }

  async generate(prompt: string, opts: GenerateOptions = {}): Promise<string | null> {
    try {
      // Cold-loading a model on CPU can take 60-100s; keep the ceiling generous
      // and configurable. A warm model responds in a few seconds. If it times
      // out, generate returns null and the engine uses its deterministic path.
      const timeoutMs = opts.timeoutMs ?? Number(process.env.OLLAMA_TIMEOUT_MS || 90_000);
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const doFetch = fetch(`${this.baseUrl}/api/generate`, {
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
      // Hard backstop: even if the abort signal is missed, never hang past the
      // deadline + a small grace. Guarantees the engine can't stick in "planning".
      const res = await Promise.race([
        doFetch,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs + 2000)),
      ]);
      clearTimeout(t);
      if (!res || !("ok" in res) || !res.ok) return null;
      const data = (await res.json()) as { response?: string };
      return data.response?.trim() || null;
    } catch {
      return null;
    }
  }
}
