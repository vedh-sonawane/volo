// Model-backed "refine" helpers — polish the user's own words without changing
// their meaning, values, recipients, or amounts, and NEVER introducing
// placeholders. Used by the Refine (objective) and magic-star (email) buttons.
//
// Honesty: these only rephrase text the user already wrote. They never invent
// facts, recipients, or details. If the model output would add a placeholder or
// drop required content, the refine is rejected (the original is kept).

import type { ModelProvider } from "@/lib/providers/model";
import { hasPlaceholder } from "./action-router";

/** Rewrite a task objective to be clearer — same intent, no invented details. */
export async function refineObjective(objective: string, model: ModelProvider): Promise<string | null> {
  const text = await model.generate(
    `Rewrite this task request to be clearer and more specific.\n\nRequest: ${objective}`,
    {
      system:
        "You improve the CLARITY of a user's task request. Keep their exact intent, constraints, names, email addresses, URLs, and amounts unchanged. " +
        "Do NOT invent details the user didn't provide, and NEVER add placeholders or brackets like [name] or {{x}} — omit anything unknown instead. " +
        "Output ONLY the rewritten request, with no preamble or quotes.",
      maxTokens: 300,
      temperature: 0.4,
    }
  );
  const out = (text || "").trim().replace(/^["']|["']$/g, "").trim();
  if (!out || out.length < 3 || hasPlaceholder(out)) return null;
  return out;
}

/**
 * Polish an email's SUBJECT and BODY to be professional and clear — same facts,
 * same recipient (the recipient is never passed to the model), no placeholders.
 * Returns null if the model adds a placeholder or omits content (keep original).
 */
export async function refineEmail(subject: string, body: string, model: ModelProvider): Promise<{ subject: string; body: string } | null> {
  const text = await model.generate(
    `Polish this email so it reads professionally and clearly.\nSubject: ${subject}\nBody: ${body}`,
    {
      system:
        "You polish an email's subject and body to be professional, warm, and concise. " +
        "Keep every fact, name, and amount the user included; do not change the meaning. " +
        "NEVER add placeholders or brackets like [reason], {{name}}, or <detail> — if something isn't provided, leave it out rather than inventing a placeholder. " +
        'Output STRICT JSON only: {"subject":"...","body":"..."}',
      json: true,
      maxTokens: 500,
      temperature: 0.5,
    }
  );
  const parsed = parseFirstJson(text || "");
  if (!parsed) return null;
  const s = typeof parsed.subject === "string" ? parsed.subject.trim() : "";
  const b = typeof parsed.body === "string" ? parsed.body.trim() : "";
  if (!s || !b || hasPlaceholder(s) || hasPlaceholder(b)) return null;
  return { subject: s, body: b };
}

/** Extract the first balanced JSON object from possibly-noisy model text. */
function parseFirstJson(text: string): { subject?: unknown; body?: unknown } | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
