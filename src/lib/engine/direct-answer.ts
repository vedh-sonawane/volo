// Direct informational / creative answer composition.
//
// A connected GENERATIVE model (any LLM — Ollama today) can answer directly:
// explanations, drafts, summaries, factual Q&A, creative writing. This is a
// model CAPABILITY, derived from `model.generative` — never from provider-specific
// special-casing. We trust the resolver (which only returns a usable provider) and
// NEVER conflate a transient generation hiccup with "no model connected".

import type { ModelProvider } from "@/lib/providers/model";
import type { FinalResult, Task } from "@/lib/types";

export interface DirectAnswer {
  text: string;
  modelUsed: boolean;
  /** True when a generative model was actually available to attempt the answer. */
  hasModel: boolean;
}

export async function generateDirectAnswer(objective: string, model: ModelProvider): Promise<DirectAnswer> {
  // Only a generative model can compose an answer. (Deterministic providers can't,
  // and Volo never fabricates one.) resolveModel already verified availability —
  // we do NOT re-ping and mislabel a hiccup as "no model".
  if (!model.generative) return { text: "", modelUsed: false, hasModel: false };

  const text = await model.generate(`Respond to this request directly and helpfully.\n\nRequest: ${objective}`, {
    system:
      "You answer a user's request directly. If it is creative (a joke, story, name, idea, poem, etc.), produce it. " +
      "If it is a general-knowledge or reasoning question, answer it clearly. If it asks you to write or draft something " +
      "(an email, a message, a summary), write it. " +
      "Do NOT fabricate specific real-world facts, prices, current events, statistics, or sources you are unsure of — " +
      "if the request genuinely needs up-to-date or external information you don't have, say so in one sentence instead of guessing. " +
      "CRITICAL — you are a text generator with NO ability to take actions or access accounts: you cannot send email, create or modify calendar events, " +
      "book, pay, submit forms, or read the user's real data from any service (GitHub, Google, etc.). NEVER claim you did any of these or that " +
      "something was added/created/updated/scheduled/sent/booked. If the request asks to perform such an action or to fetch the user's real " +
      "account data, do not pretend — state plainly that it needs a connected integration and that you cannot do it here.",
    maxTokens: 700,
    temperature: 0.7,
  });

  const trimmed = (text || "").trim();
  return { text: trimmed, modelUsed: trimmed.length > 0, hasModel: true };
}

export function directAnswerFinal(task: Task, answer: DirectAnswer): FinalResult {
  void task;
  if (answer.text) {
    return {
      headline: "Direct answer",
      summary: answer.text,
      takeaways: [],
      limitations: ["Composed from the model's general knowledge, not verified against live sources. For current or external facts, ask for up-to-date info and Volo will research it."],
      offeredActions: [],
      nextAction: "Ask a follow-up, refine the request, or ask Volo to research it for current/verified facts.",
      modelUsed: true,
    };
  }
  // A model IS connected, but it didn't return text this time (timeout / busy /
  // empty). Report that honestly — do NOT claim "no model is connected".
  if (answer.hasModel) {
    return {
      headline: "The model didn't return an answer",
      summary:
        "A connected AI model is available and this request is directly answerable, but the model didn't produce a response this time (it may have timed out or been busy loading). Please try again — nothing was fabricated.",
      takeaways: [],
      limitations: ["If this keeps happening, the local model may be slow to load; try again, use a smaller model, or raise the model timeout."],
      offeredActions: [],
      nextAction: "Re-run this objective. If it persists, check the model in Settings.",
      modelUsed: false,
    };
  }
  // Genuinely no generative model connected — nothing to compose with.
  return {
    headline: "Connect a model to answer this directly",
    summary:
      "This request can be answered directly — it needs no web research. But no AI model is connected, so Volo has nothing to compose the answer with and will not fabricate one. Connect a free local model (Ollama) in Settings, then re-run.",
    takeaways: [],
    limitations: ["Volo never invents a creative or factual answer without a model — that would be dishonest."],
    offeredActions: [],
    nextAction: "Enable Ollama (free, local) in Settings, then re-run this objective.",
    modelUsed: false,
  };
}
