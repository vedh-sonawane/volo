// Research provider factory. The engine calls getResearchProvider() and depends
// only on the ResearchProvider interface — never a concrete backend.

import type { ResearchProvider } from "./types";
import { DuckDuckGoProvider } from "./duckduckgo";
import { MockResearchProvider } from "./mock";

export type { ResearchProvider, SearchResult, FetchedPage } from "./types";

let cached: ResearchProvider | null = null;

export function getResearchProvider(): ResearchProvider {
  if (cached) return cached;
  const choice = (process.env.RESEARCH_PROVIDER || "duckduckgo").toLowerCase();
  switch (choice) {
    case "mock":
      cached = new MockResearchProvider();
      break;
    case "duckduckgo":
    default:
      cached = new DuckDuckGoProvider();
      break;
  }
  return cached;
}
