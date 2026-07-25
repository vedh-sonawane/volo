// Free DuckDuckGo research provider — no API key, no account, no credit card.
//
// Uses DuckDuckGo's public HTML endpoint for search (the same page a browser
// would load) and plain fetch for page retrieval. This is a best-effort free
// method; if DDG rate-limits or changes markup, the provider degrades to an
// empty result set rather than throwing — the engine handles that honestly.

import * as cheerio from "cheerio";
import type { FetchedPage, ResearchProvider, SearchResult } from "./types";
import { extractReadable } from "./extract";
import { normalizeWs } from "@/lib/util";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const SEARCH_ENDPOINT = "https://html.duckduckgo.com/html/";
const SEARCH_ENDPOINT_LITE = "https://lite.duckduckgo.com/lite/";

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
    return href.startsWith("http") ? href : "https:" + href;
  } catch {
    return href;
  }
}

export class DuckDuckGoProvider implements ResearchProvider {
  readonly name = "duckduckgo";

  async search(query: string, limit = 8): Promise<SearchResult[]> {
    // Try the primary HTML endpoint; on empty/failure, fall back to the Lite
    // endpoint (different markup + often separate rate limits). Free either way.
    const primary = await this.searchHtml(query, limit);
    if (primary.length > 0) return primary;
    return this.searchLite(query, limit);
  }

  private async searchHtml(query: string, limit: number): Promise<SearchResult[]> {
    try {
      const res = await withTimeout(
        SEARCH_ENDPOINT,
        {
          method: "POST",
          headers: {
            "User-Agent": UA,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "text/html",
          },
          body: new URLSearchParams({ q: query, kl: "us-en" }).toString(),
        },
        12_000
      );
      if (!res.ok) return [];
      const $ = cheerio.load(await res.text());
      const out: SearchResult[] = [];
      $(".result").each((_, el) => {
        if (out.length >= limit) return;
        const a = $(el).find("a.result__a").first();
        const href = a.attr("href");
        if (!href) return;
        const url = unwrap(href);
        if (!url.startsWith("http")) return;
        if ($(el).hasClass("result--ad")) return;
        const title = normalizeWs(a.text());
        const snippet = normalizeWs($(el).find(".result__snippet").first().text());
        if (title) out.push({ url, title, snippet });
      });
      return dedupByUrl(out).slice(0, limit);
    } catch {
      return [];
    }
  }

  private async searchLite(query: string, limit: number): Promise<SearchResult[]> {
    try {
      const res = await withTimeout(
        SEARCH_ENDPOINT_LITE,
        {
          method: "POST",
          headers: {
            "User-Agent": UA,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "text/html",
          },
          body: new URLSearchParams({ q: query, kl: "us-en" }).toString(),
        },
        12_000
      );
      if (!res.ok) return [];
      const $ = cheerio.load(await res.text());
      const out: SearchResult[] = [];
      // Lite renders results as a table of anchors with class "result-link".
      $("a.result-link").each((_, el) => {
        if (out.length >= limit) return;
        const href = $(el).attr("href");
        if (!href) return;
        const url = unwrap(href);
        if (!url.startsWith("http")) return;
        const title = normalizeWs($(el).text());
        if (title) out.push({ url, title, snippet: "" });
      });
      return dedupByUrl(out).slice(0, limit);
    } catch {
      return [];
    }
  }

  async fetch(url: string): Promise<FetchedPage> {
    try {
      const res = await withTimeout(
        url,
        { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, redirect: "follow" },
        15_000
      );
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
