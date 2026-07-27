// Research provider factory. The engine calls getResearchProvider() and depends
// only on the ResearchProvider interface — never a concrete backend.

import type { ResearchProvider } from "./types";
import { DuckDuckGoProvider } from "./duckduckgo";
import { MockResearchProvider } from "./mock";
import { cfg } from "@/lib/config";

export type { ResearchProvider, SearchResult, SearchResponse, SearchStatus, FetchedPage } from "./types";

// Resolved per call (cheap) so a settings change takes effect without a restart.
export function getResearchProvider(): ResearchProvider {
  const choice = cfg("RESEARCH_PROVIDER", "duckduckgo").toLowerCase();
  return choice === "mock" ? new MockResearchProvider() : new DuckDuckGoProvider();
}
