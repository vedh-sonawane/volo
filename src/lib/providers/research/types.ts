// ─────────────────────────────────────────────────────────────────────────────
// ResearchProvider abstraction (Phase 3).
//
// The rest of the application MUST depend only on this interface, never on a
// concrete search backend. Swapping DuckDuckGo for another free/open source, or
// a future paid provider, means adding one file — nothing else changes.
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface FetchedPage {
  url: string;
  finalUrl: string;
  title: string;
  /** Cleaned, readable plain text. */
  text: string;
  /** Outbound links discovered on the page (absolute URLs). */
  links: string[];
  words: number;
  ok: boolean;
  error?: string;
}

export interface ResearchProvider {
  /** Provider id for transparency in the UI. */
  readonly name: string;
  /** Free-text web search. Returns ranked results. */
  search(query: string, limit?: number): Promise<SearchResult[]>;
  /** Fetch a URL and return cleaned, readable content + links. */
  fetch(url: string): Promise<FetchedPage>;
}
