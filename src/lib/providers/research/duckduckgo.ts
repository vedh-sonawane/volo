// Free DuckDuckGo research provider — no API key, no account, no credit card.
//
// Uses DuckDuckGo's public HTML endpoint for search (the same page a browser
// would load) and plain fetch for page retrieval. This is a best-effort free
// method. It reports an HONEST, STRUCTURED status: a genuine zero-result search
// ("empty") is never conflated with a provider failure, a rate-limit/block, a
// timeout, or a markup change we couldn't parse. Callers use that status to tell
// the user the truth instead of silently claiming "found nothing".

import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { FetchedPage, ResearchProvider, SearchResponse, SearchResult, SearchStatus } from "./types";
import { extractReadable } from "./extract";
import { normalizeWs } from "@/lib/util";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const SEARCH_ENDPOINT = "https://html.duckduckgo.com/html/";
const SEARCH_ENDPOINT_LITE = "https://lite.duckduckgo.com/lite/";

const SEARCH_TIMEOUT_MS = 12_000;

/** Marker phrases DDG serves on a throttle / bot-challenge / anomaly page. */
const BLOCK_MARKERS = /anomaly|unusual traffic|are you a robot|too many requests|rate.?limit|temporarily blocked|detected unusual/i;

interface EndpointOutcome {
  results: SearchResult[];
  status: SearchStatus;
  error?: string;
}

async function withTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** DDG wraps result links in a redirect: /l/?uddg=<encoded target>. Unwrap it. */
function unwrap(href: string): string {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const target = u.searchParams.get("uddg");
    if (target) return decodeURIComponent(target);
    // Only a protocol-relative "//host/path" gets a scheme; anything else
    // (e.g. "javascript:void(0)") is returned as-is so the http filter drops it.
    if (href.startsWith("http")) return href;
    if (href.startsWith("//")) return "https:" + href;
    return href;
  } catch {
    return href;
  }
}

function classifyError(e: unknown): EndpointOutcome {
  const msg = e instanceof Error ? e.message : "fetch failed";
  const isAbort = e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message));
  return { results: [], status: isAbort ? "timeout" : "error", error: isAbort ? `search timed out after ${SEARCH_TIMEOUT_MS}ms` : msg };
}

/**
 * Turn an HTTP response into a structured outcome. Separates:
 *   • throttle/block statuses (202/403/429) or anomaly pages → rate_limited
 *   • other non-2xx → error
 *   • 2xx with parsed results → ok
 *   • 2xx, scaffold present, no matches → empty (a real zero-result)
 *   • 2xx, result anchors present but none extracted → error (markup changed)
 *   • 2xx, no recognizable results scaffold at all → error (blocked/changed)
 */
function classifyResponse(status: number, html: string, parse: ($: CheerioAPI) => SearchResult[], anchorSel: string, scaffoldSel: string): EndpointOutcome {
  if (status === 202 || status === 403 || status === 429) {
    return { results: [], status: "rate_limited", error: `provider throttled (HTTP ${status})` };
  }
  if (status < 200 || status >= 300) {
    return { results: [], status: "error", error: `HTTP ${status}` };
  }

  const $ = cheerio.load(html);
  const results = parse($);
  // Results found → success (checked BEFORE block markers so a legitimate result
  // whose snippet merely contains e.g. "rate limit" is never misread as a block).
  if (results.length > 0) return { results, status: "ok" };

  // Zero results — a block/anomaly page (only meaningful when nothing parsed).
  if (BLOCK_MARKERS.test(html)) {
    return { results: [], status: "rate_limited", error: "provider returned a block/anomaly page" };
  }

  // Decide whether the empty result is genuine or a failure to parse.
  const hasAnchors = $(anchorSel).length > 0;
  const hasScaffold = $(scaffoldSel).length > 0;
  const saysNoResults = $(".no-results").length > 0 || /\bno results\b|no more results|did not match/i.test(html);

  if (hasAnchors) {
    // The result anchors exist but we extracted none → our extraction/markup
    // assumption broke. Report honestly rather than as an empty search.
    return { results: [], status: "error", error: "results present but could not be parsed (markup may have changed)" };
  }
  if (saysNoResults || hasScaffold) {
    // A normal results page that genuinely contains zero matches.
    return { results: [], status: "empty" };
  }
  // No scaffold, no anchors, no "no results" text → unexpected page (often a soft block).
  return { results: [], status: "error", error: "unrecognized response (possible block or markup change)" };
}

export class DuckDuckGoProvider implements ResearchProvider {
  readonly name = "duckduckgo";

  async search(query: string, limit = 8): Promise<SearchResponse> {
    // Try the primary HTML endpoint; if it didn't return usable results, try the
    // Lite endpoint (different markup + often separate rate limits). Free either
    // way. The combined status is chosen to be MAXIMALLY HONEST (see below).
    const html = await this.searchHtml(query, limit);
    if (html.status === "ok") return { ...html, via: "html.duckduckgo.com" };

    const lite = await this.searchLite(query, limit);
    if (lite.status === "ok") return { ...lite, via: "lite.duckduckgo.com" };

    // Neither returned results. Pick the most informative/honest status.
    //   • A definitive "empty" from EITHER endpoint means a real zero-result.
    //   • Otherwise surface the failure (rate_limited > timeout > error) so a
    //     provider problem is NEVER masked as "no results".
    if (html.status === "empty" || lite.status === "empty") {
      return { results: [], status: "empty" };
    }
    const worst = pickFailure(html.status, lite.status);
    const error = (worst === html.status ? html.error : lite.error) || html.error || lite.error;
    return { results: [], status: worst, error };
  }

  private async searchHtml(query: string, limit: number): Promise<EndpointOutcome> {
    let res: Response;
    try {
      res = await withTimeout(
        SEARCH_ENDPOINT,
        {
          method: "POST",
          headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html" },
          body: new URLSearchParams({ q: query, kl: "us-en" }).toString(),
        },
        SEARCH_TIMEOUT_MS
      );
    } catch (e) {
      return classifyError(e);
    }
    let html: string;
    try {
      html = await res.text();
    } catch (e) {
      return classifyError(e);
    }
    return classifyResponse(res.status, html, ($) => parseHtml($, limit), "a.result__a", "#links, .serp__results, .results");
  }

  private async searchLite(query: string, limit: number): Promise<EndpointOutcome> {
    let res: Response;
    try {
      res = await withTimeout(
        SEARCH_ENDPOINT_LITE,
        {
          method: "POST",
          headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html" },
          body: new URLSearchParams({ q: query, kl: "us-en" }).toString(),
        },
        SEARCH_TIMEOUT_MS
      );
    } catch (e) {
      return classifyError(e);
    }
    let html: string;
    try {
      html = await res.text();
    } catch (e) {
      return classifyError(e);
    }
    return classifyResponse(res.status, html, ($) => parseLite($, limit), "a.result-link", "table, .filters");
  }

  async fetch(url: string): Promise<FetchedPage> {
    try {
      const res = await withTimeout(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, redirect: "follow" }, 15_000);
      const finalUrl = res.url || url;
      if (!res.ok) {
        return blank(url, finalUrl, `HTTP ${res.status}`);
      }
      const ctype = res.headers.get("content-type") || "";
      if (!ctype.includes("html") && !ctype.includes("text")) {
        return blank(url, finalUrl, `unsupported content-type: ${ctype || "unknown"}`);
      }
      const html = await res.text();
      const { title, text, links } = extractReadable(html, finalUrl);
      const words = text ? text.split(/\s+/).length : 0;
      return { url, finalUrl, title, text, links, words, ok: true };
    } catch (e) {
      return blank(url, url, e instanceof Error ? e.message : "fetch failed");
    }
  }
}

// ── parsers (exported for testing) ───────────────────────────────────────────

/**
 * Parse the HTML-endpoint results. Iterates the result ANCHORS directly
 * (`a.result__a`) rather than a wrapper class — DDG has renamed the wrapper more
 * than once (result → web-result / result__body), so anchoring on the stable
 * link class is robust to that. The snippet is read from the enclosing result
 * body; sponsored results (result--ad) are skipped.
 */
export function parseHtml($: CheerioAPI, limit = 8): SearchResult[] {
  const out: SearchResult[] = [];
  $("a.result__a").each((_, el) => {
    if (out.length >= limit) return;
    const a = $(el);
    const href = a.attr("href");
    if (!href) return;
    const url = unwrap(href);
    if (!url.startsWith("http")) return;
    const body = a.closest(".result__body, .result, .web-result, .results_links");
    if (body.hasClass("result--ad") || body.find(".badge--ad").length > 0) return;
    const title = normalizeWs(a.text());
    const snippet = normalizeWs(body.find(".result__snippet").first().text());
    if (title) out.push({ url, title, snippet });
  });
  return dedupByUrl(out).slice(0, limit);
}

/** Parse the Lite-endpoint results (a table of `a.result-link` anchors). */
export function parseLite($: CheerioAPI, limit = 8): SearchResult[] {
  const out: SearchResult[] = [];
  $("a.result-link").each((_, el) => {
    if (out.length >= limit) return;
    const a = $(el);
    const href = a.attr("href");
    if (!href) return;
    const url = unwrap(href);
    if (!url.startsWith("http")) return;
    const title = normalizeWs(a.text());
    if (title) out.push({ url, title, snippet: "" });
  });
  return dedupByUrl(out).slice(0, limit);
}

/** Precedence for combining two failed endpoints: rate_limited > timeout > error. */
function pickFailure(a: SearchStatus, b: SearchStatus): SearchStatus {
  const rank: Record<SearchStatus, number> = { rate_limited: 3, timeout: 2, error: 1, empty: 0, ok: -1 };
  return rank[a] >= rank[b] ? a : b;
}

function blank(url: string, finalUrl: string, error: string): FetchedPage {
  return { url, finalUrl, title: url, text: "", links: [], words: 0, ok: false, error };
}

function dedupByUrl(items: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = i.url.split("#")[0];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
