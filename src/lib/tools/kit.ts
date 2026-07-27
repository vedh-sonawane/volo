// ─────────────────────────────────────────────────────────────────────────────
// The executable tool kit.
//
// Volo is an objective-execution engine, not a research pipeline. Web research
// is just a few of the tools below. Every capability — search, page reading,
// document reading, drafting, and (declared) consequential actions — implements
// ONE interface, `ExecutableTool`, and communicates through a shared blackboard
// on the run context. The planner selects and sequences these dynamically; the
// execution engine dispatches to them generically. Adding a new capability means
// adding one entry here — nothing else in the engine changes.
//
// Honesty is structural: a tool declares whether it is actually `implemented`
// for free. Tools that would have real external consequences (send_email, book,
// submit_form, monitor_inbox, calendar_event) are declared but NOT implemented;
// the engine turns them into approval requests and, on approval, produces a safe
// artifact (a draft / exact steps) instead of faking a side effect.
// ─────────────────────────────────────────────────────────────────────────────

import type { Comparison, PermissionLevel, ResultItem, Source, StreamEvent, Task, TaskConstraints } from "@/lib/types";
import { getResearchProvider } from "@/lib/providers/research";
import type { FetchedPage, SearchResult, SearchStatus } from "@/lib/providers/research";
import { extractStructured } from "@/lib/engine/extract-structured";
import { compareResults, parsePrice } from "@/lib/engine/compare";
import { combineDomains } from "@/lib/engine/combine";
import { schemaFor } from "@/lib/engine/domains";
import { draftEmail } from "@/lib/tools/email-draft";
import { hostOf } from "@/lib/util";

/**
 * Shared execution context passed to every tool. The `scope*` methods make a
 * tool operate either globally (single-domain — unchanged) or within the current
 * sub-plan (multi-domain). Tools never touch task.results/comparison directly;
 * they go through scope so the same tool works in both modes.
 */
export interface ToolContext {
  task: Task;
  /** Transient inter-tool data (search results, fetched pages, drafts…). */
  bb: Map<string, unknown>;
  maxFetches: number;
  log(level: "info" | "success" | "warn" | "error", message: string, detail?: string, stepId?: string): void;
  addSource(s: Source): void;
  emit(e: StreamEvent): void;
  persist(): void;
  /** Constraints for the current scope (a sub-plan's, or the global task's). */
  scopeConstraints(): TaskConstraints;
  /** Namespace a blackboard key to the current scope. */
  scopeBbKey(base: string): string;
  /** Read/write the results + comparison of the current scope. */
  getScopeResults(): ResultItem[];
  setScopeResults(items: ResultItem[]): void;
  setScopeComparison(c: Comparison): void;
}

export interface ToolRunResult {
  ok: boolean;
  summary: string;
  output?: unknown;
  confidence?: number;
  error?: string;
}

export interface ExecutableTool {
  name: string;
  title: string;
  description: string;
  permission: PermissionLevel;
  /** True when running this tool needs explicit user approval first. */
  requiresApproval: boolean;
  /** True when the tool actually performs its function for free. */
  implemented: boolean;
  /** Human note about failure behaviour. */
  onError: string;
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolRunResult>;
}

// ── blackboard helpers (scope-namespaced) ────────────────────────────────────
function getUrls(ctx: ToolContext): SearchResult[] {
  return (ctx.bb.get(ctx.scopeBbKey("urls")) as SearchResult[]) ?? [];
}
function getPages(ctx: ToolContext): FetchedPage[] {
  return (ctx.bb.get(ctx.scopeBbKey("pages")) as FetchedPage[]) ?? [];
}

// ── generic ranking of candidate pages (used by fetch_page) ──────────────────
const BLOCK_HOSTS = ["pinterest.", "facebook.", "instagram.", "tiktok.", "youtube.", "reddit.com/login"];
const INFO_TITLE = /\b(how to|become|becoming|guide|register|registration|renew|apply|licen[sc]e|regulation|policy|wikipedia|what is|requirements|qualif)/i;
const REFERENCE_HOST = /(^|\.)gov(\.|$)|\.gov\.|wikipedia\.org|\.gov$/i;

function rankPages(results: SearchResult[], c: TaskConstraints): SearchResult[] {
  const schema = schemaFor(c.domain, c.outcome);
  const wantsCandidates = c.outcome === "candidates";
  const kw = [...c.keywords, ...(c.location && c.location !== "near me" ? [c.location.toLowerCase()] : [])];
  return results
    .filter((r) => !BLOCK_HOSTS.some((h) => r.url.includes(h)))
    .map((r) => {
      const hay = `${r.title} ${r.snippet}`.toLowerCase();
      let host = "";
      try {
        host = new URL(r.url).hostname;
      } catch {
        /* ignore */
      }
      let score = 0;
      for (const k of kw) if (hay.includes(k)) score += 2;
      for (const h of schema.entityHints) if (hay.includes(h)) score += 1;
      if (parsePrice(hay) != null) score += 1;
      if (wantsCandidates) {
        if (/\b(book|booking|contact|call|near you|reviews?|rated|available|hire)\b/.test(hay)) score += 2;
        if (INFO_TITLE.test(r.title)) score -= 4;
        if (REFERENCE_HOST.test(host)) score -= 5;
      }
      return { r, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.r);
}

function topCandidate(task: Task): ResultItem | null {
  const cmp = task.comparison;
  if (!cmp) return null;
  const first = cmp.recommendedIds
    .map((id) => cmp.items.find((i) => i.id === id))
    .find((i) => i && i.kind === "candidate");
  return first ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The tools
// ─────────────────────────────────────────────────────────────────────────────

const reason: ExecutableTool = {
  name: "reason",
  title: "Understand the objective",
  description: "Interpret the objective into constraints and required outcome (no external calls).",
  permission: "research",
  requiresApproval: false,
  implemented: true,
  onError: "Cannot fail — works from the parsed objective.",
  async run(_input, ctx) {
    const c = ctx.task.constraints;
    const bits = [`wants: ${c.outcome}`, `type: ${c.domain}`];
    if (c.location) bits.push(`location: ${c.location}`);
    if (c.maxPrice != null) bits.push(`budget: $${c.maxPrice}${c.priceUnit ? "/" + c.priceUnit : ""}`);
    if (c.timeframe) bits.push(`when: ${c.timeframe}`);
    ctx.log("info", "Interpreted the objective", bits.join(" · "));
    return { ok: true, summary: `Outcome = ${c.outcome}`, confidence: 0.9, output: c };
  },
};

const direct_answer: ExecutableTool = {
  name: "direct_answer",
  title: "Compose a direct answer",
  description: "Answer an informational/creative request directly from knowledge/generation — no web research.",
  permission: "research",
  requiresApproval: false,
  implemented: true,
  onError: "If no model is connected, Volo says so honestly instead of fabricating an answer.",
  async run(_input, ctx) {
    // The actual composition happens in finalize (where the model is available);
    // this step marks the phase and never touches the web. Its presence GUARANTEES
    // a direct-answer objective runs zero research tools.
    ctx.log("info", "Answering directly — no web search, categories, or comparison needed for this request.");
    return { ok: true, summary: "composing a direct answer", confidence: 0.7 };
  },
};

const web_search: ExecutableTool = {
  name: "web_search",
  title: "Search the web",
  description: "Free web search via the research provider. Collects candidate URLs.",
  permission: "research",
  requiresApproval: false,
  implemented: true,
  onError: "Returns no URLs; the run continues and reports the gap honestly.",
  async run(input, ctx) {
    const query = String(input.query || "");
    const research = getResearchProvider();
    ctx.task.researchProvider = research.name;
    const resp = await research.search(query, 8);
    const results = resp.results;
    const prev = getUrls(ctx);
    const merged = dedupeUrls([...prev, ...results]);
    ctx.bb.set(ctx.scopeBbKey("urls"), merged);

    // HONESTY: a provider failure (rate-limit/timeout/error) is NOT the same as a
    // genuine zero-result search. Report each truthfully so nothing is masked.
    const failed = resp.status !== "ok" && resp.status !== "empty";
    if (results.length > 0) {
      ctx.log("success", `Search "${query}" → ${results.length} result${results.length === 1 ? "" : "s"}`);
    } else if (failed) {
      ctx.log("warn", `Search "${query}" could not complete: ${searchStatusMessage(resp.status, resp.error)}`, resp.error);
    } else {
      ctx.log("info", `Search "${query}" → 0 results (the provider responded, but nothing matched).`);
    }

    return {
      ok: results.length > 0,
      summary: results.length ? `${results.length} results` : failed ? `search ${resp.status}` : "0 results",
      confidence: results.length ? 0.7 : 0.2,
      error: results.length ? undefined : searchStatusMessage(resp.status, resp.error),
      output: results.map((r) => r.url),
    };
  },
};

/** An honest, user-facing message for a non-successful search status. */
function searchStatusMessage(status: SearchStatus, detail?: string): string {
  switch (status) {
    case "empty":
      return "No results matched this query (the search provider responded normally).";
    case "rate_limited":
      return "The free search provider is rate-limiting requests right now — no results this attempt. It usually recovers shortly; try again in a moment.";
    case "timeout":
      return `The search request timed out${detail ? ` (${detail})` : ""}. No results were returned.`;
    case "error":
      return `The search provider returned an error${detail ? `: ${detail}` : ""}. No results were returned.`;
    default:
      return detail || "No results.";
  }
}

const fetch_page: ExecutableTool = {
  name: "fetch_page",
  title: "Read the most relevant pages",
  description: "Fetch and extract readable content from the highest-ranked public pages found.",
  permission: "research",
  requiresApproval: false,
  implemented: true,
  onError: "Pages that fail to load are skipped with a reason; others still process.",
  async run(_input, ctx) {
    const research = getResearchProvider();
    const ranked = rankPages(getUrls(ctx), ctx.scopeConstraints()).slice(0, ctx.maxFetches);
    ctx.log("info", `Visiting the ${ranked.length} most relevant page${ranked.length === 1 ? "" : "s"}`);
    const pages = await Promise.all(
      ranked.map(async (r) => {
        const page = await research.fetch(r.url);
        if (page.ok) {
          ctx.addSource({ url: page.finalUrl, title: page.title || r.title, snippet: r.snippet, fetchedAt: Date.now(), words: page.words });
          ctx.log("success", `Read ${hostOf(page.finalUrl)}`, `${page.words} words`);
        } else {
          ctx.log("warn", `Could not read ${hostOf(r.url)}`, page.error);
        }
        return page;
      })
    );
    const ok = pages.filter((p) => p.ok);
    ctx.bb.set(ctx.scopeBbKey("pages"), [...getPages(ctx), ...ok]);
    return { ok: ok.length > 0, summary: `${ok.length} pages read`, confidence: ok.length ? 0.7 : 0.2 };
  },
};

const read_document: ExecutableTool = {
  name: "read_document",
  title: "Read a specific document",
  description: "Fetch and read a specific public URL (e.g. a policy or product page) as evidence.",
  permission: "research",
  requiresApproval: false,
  implemented: true,
  onError: "If the document can't be read, it's reported and skipped.",
  async run(input, ctx) {
    const url = String(input.url || "");
    if (!/^https?:\/\//.test(url)) return { ok: false, summary: "no URL", error: "No valid URL provided" };
    const page = await getResearchProvider().fetch(url);
    if (page.ok) {
      ctx.addSource({ url: page.finalUrl, title: page.title, fetchedAt: Date.now(), words: page.words });
      ctx.bb.set(ctx.scopeBbKey("pages"), [...getPages(ctx), page]);
      ctx.log("success", `Read document ${hostOf(page.finalUrl)}`, `${page.words} words`);
      return { ok: true, summary: `read ${page.words} words` };
    }
    ctx.log("warn", `Could not read document ${hostOf(url)}`, page.error);
    return { ok: false, summary: "unreadable", error: page.error };
  },
};

const extract_structured: ExecutableTool = {
  name: "extract_structured",
  title: "Extract candidates / steps",
  description: "Turn read pages into evidence-backed candidates or ordered steps, separating real entities from information.",
  permission: "research",
  requiresApproval: false,
  implemented: true,
  onError: "Rows with no extractable detail are dropped rather than fabricated.",
  async run(_input, ctx) {
    const c = ctx.scopeConstraints();
    const items = extractStructured(getPages(ctx), c);
    ctx.setScopeResults(items);
    const candidates = items.filter((i) => i.kind === "candidate").length;
    const info = items.length - candidates;
    const label = c.entityLabel || "item";
    ctx.log(
      candidates ? "success" : "warn",
      `Identified ${candidates} actual ${label}${candidates === 1 ? "" : "s"}` + (info ? `, set aside ${info} informational page${info === 1 ? "" : "s"}` : "")
    );
    return { ok: candidates > 0 || c.outcome !== "candidates", summary: `${candidates} candidates, ${info} info`, confidence: candidates ? 0.6 : 0.2 };
  },
};

const compare: ExecutableTool = {
  name: "compare",
  title: "Compare and rank candidates",
  description: "Filter candidates by constraints and rank them transparently.",
  permission: "recommend",
  requiresApproval: false,
  implemented: true,
  onError: "If nothing qualifies, returns an empty comparison with an explanation.",
  async run(_input, ctx) {
    const comparison = compareResults(ctx.getScopeResults(), ctx.scopeConstraints());
    ctx.setScopeComparison(comparison);
    ctx.log("info", comparison.rationale);
    return { ok: true, summary: `${comparison.recommendedIds.length} recommended`, confidence: comparison.recommendedIds.length ? 0.7 : 0.3 };
  },
};

const combine_domains: ExecutableTool = {
  name: "combine_domains",
  title: "Combine across categories",
  description: "Join the ranked candidates from every sub-plan into cross-category combinations under the shared budget.",
  permission: "recommend",
  requiresApproval: false,
  implemented: true,
  onError: "Categories with no options are reported as missing; combinations aren't fabricated.",
  async run(_input, ctx) {
    const subs = ctx.task.subPlans ?? [];
    const combination = combineDomains(subs, ctx.task.constraints);
    ctx.task.combination = combination;
    ctx.emit({ type: "task", task: ctx.task });
    ctx.persist();
    ctx.log(
      combination.options.length ? "success" : "warn",
      combination.rationale
    );
    return { ok: combination.options.length > 0, summary: `${combination.options.length} combinations`, confidence: combination.options.length ? 0.7 : 0.3 };
  },
};

const draft_email: ExecutableTool = {
  name: "draft_email",
  title: "Draft an enquiry",
  description: "Prepare (never send) an enquiry to the top candidate. Downloadable as .eml.",
  permission: "recommend",
  requiresApproval: false,
  implemented: true,
  onError: "Never sends; on failure returns the draft text so nothing is lost.",
  async run(_input, ctx) {
    // DIRECT ACTION: the user supplied the exact recipient/subject/body. Prepare
    // that email verbatim — never a researched provider, never a placeholder, and
    // never rewriting the user's subject/body.
    const da = ctx.task.directAction;
    if (da && da.capability === "send_email") {
      const draft = draftEmail({ to: da.target, subject: da.params.subject ?? "", body: da.params.body ?? "" });
      ctx.bb.set("draft", draft);
      ctx.log("success", `Prepared the exact email you specified to ${da.target}`, `Subject: ${da.params.subject ?? "(none)"}`);
      return { ok: true, summary: `draft ready for ${da.target}`, output: draft };
    }

    const first = topCandidate(ctx.task);
    const c = ctx.task.constraints;
    // For a candidates objective we draft to the top provider; for a procedure
    // (refund/cancel) there's no candidate, so we prepare a request to "the
    // provider" for the user to address. Drafting always succeeds — it's safe.
    const to = first?.attributes.contact || first?.attributes.website || "[add the provider's email]";
    const isRequest = c.outcome === "procedure";
    const body = isRequest
      ? [
          "Hello,",
          "",
          `I would like to proceed with the following: ${ctx.task.objective}.`,
          "Please let me know the required steps and confirm once it is done.",
          "",
          "Thank you,",
          "(draft prepared by Volo — add recipient details, review, and edit before sending)",
        ].join("\n")
      : [
          "Hello,",
          "",
          `I'm interested in your service regarding: ${ctx.task.objective}.`,
          `Could you confirm your pricing${c.timeframe ? ` and availability for ${c.timeframe}` : " and availability"}?`,
          "",
          "Thank you,",
          "(draft prepared by Volo — review and edit before sending)",
        ].join("\n");
    const draft = draftEmail({
      to,
      subject: isRequest ? `Request: ${ctx.task.objective.slice(0, 55)}` : `Enquiry: ${ctx.task.objective.slice(0, 55)}`,
      body,
    });
    ctx.bb.set("draft", draft);
    const who = first ? first.name : "the provider";
    ctx.log("success", `Prepared a draft ${isRequest ? "request" : "enquiry"} to ${who}`, to);
    return { ok: true, summary: `draft ready for ${who}`, output: draft };
  },
};

// ── Declared consequential actions (NOT implemented for free) ────────────────
// These are never auto-run: the engine turns them into approval requests. On
// approval, the approve route produces a safe artifact (draft / steps).
function declaredAction(
  name: string,
  title: string,
  description: string,
  onError: string,
  implemented = false
): ExecutableTool {
  return {
    name,
    title,
    description,
    permission: "action",
    requiresApproval: true,
    implemented,
    onError,
    async run(_input, _ctx) {
      // Action tools are performed by the approval route, not the auto-loop
      // (they're guarded by requiresApproval). This is never reached in normal flow.
      return { ok: false, summary: "requires approval; performed on approval", error: onError };
    },
  };
}

export const KIT: Record<string, ExecutableTool> = {
  reason,
  direct_answer,
  web_search,
  fetch_page,
  read_document,
  extract_structured,
  compare,
  combine_domains,
  draft_email,
  send_email: declaredAction(
    "send_email",
    "Send the enquiry",
    "Send the prepared email to the provider.",
    "Sends via your own configured free email account (SMTP). If none is configured, a ready-to-send draft (.eml) is produced instead — nothing is sent silently.",
    true
  ),
  submit_form: declaredAction(
    "submit_form",
    "Submit the form",
    "Submit a web form (application / sign-up / cancellation) on your behalf.",
    "Not enabled in the free version — approving gives you the exact fields and steps to submit it yourself."
  ),
  book: declaredAction(
    "book",
    "Make the booking",
    "Make a booking or reservation (an external commitment).",
    "Not enabled in the free version — approving gives you the exact booking link and steps."
  ),
  payment: declaredAction(
    "payment",
    "Make the payment",
    "Pay a supported payment target (a money transfer).",
    "Not enabled in the free version — Volo never charges a card without a secure, tokenized integration. Approving gives you the exact steps to pay it yourself. (Set ACTION_MODE=sandbox to exercise the flow in test mode.)"
  ),
  monitor_inbox: declaredAction(
    "monitor_inbox",
    "Watch for a reply",
    "Monitor an inbox for the provider's response and resume the objective.",
    "Not enabled in the free version — requires a connected mailbox. Check back and update the objective manually for now."
  ),
  calendar_event: declaredAction(
    "calendar_event",
    "Export a calendar file (.ics)",
    "Export a downloadable .ics file for an event (you import it yourself — not a calendar-service event).",
    "Produces a real, standards-compliant .ics FILE you import into your calendar app — a file export, not an event created in Google/Outlook. Generated locally, no account.",
    true
  ),
};

function dedupeUrls(items: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of items) {
    const key = r.url.split("#")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
