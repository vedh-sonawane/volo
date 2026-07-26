// Domain schemas — the structured columns Volo extracts per objective type
// (Phase 6). Keeping these declarative lets the extractor and comparison UI
// stay generic while still producing domain-appropriate tables.

import type { TaskConstraints } from "@/lib/types";

export interface DomainSchema {
  /** Ordered columns to display/extract. `price` is special (used for filter). */
  columns: string[];
  /** Words that hint a search result is a real option vs. a listicle/blog. */
  entityHints: string[];
  /** Label for a single option, used in copy. */
  noun: string;
}

// Generic provider schema for a "candidates" objective with no specific domain
// (bike shop, campsite, clinic, etc.). Columns are the concrete signals that
// mark a real provider — the same signals the candidate validator looks for.
export const GENERIC_CANDIDATE_SCHEMA: DomainSchema = {
  columns: ["price", "location", "availability", "rating", "contact", "website"],
  entityHints: ["book", "contact", "hours", "price", "reviews", "address"],
  noun: "option",
};

export const DOMAIN_SCHEMAS: Record<TaskConstraints["domain"], DomainSchema> = {
  instructors: {
    columns: ["price", "location", "availability", "rating", "contact", "website"],
    entityHints: ["instructor", "lessons", "driving school", "tutor", "book"],
    noun: "instructor",
  },
  restaurants: {
    columns: ["price", "cuisine", "location", "hours", "dietary", "booking"],
    entityHints: ["menu", "reservation", "restaurant", "book a table", "opening hours"],
    noun: "restaurant",
  },
  products: {
    columns: ["price", "specs", "seller", "warranty", "return_policy", "rating"],
    entityHints: ["specifications", "buy", "add to cart", "in stock", "review"],
    noun: "product",
  },
  flights: {
    columns: ["price", "airline", "route", "times", "stops", "booking"],
    entityHints: ["depart", "arrive", "nonstop", "airline", "book"],
    noun: "flight option",
  },
  howto: {
    columns: ["step", "detail", "source"],
    entityHints: ["step", "return", "how to", "policy", "instructions"],
    noun: "step",
  },
  general: {
    columns: ["summary", "detail", "source"],
    entityHints: [],
    noun: "finding",
  },
};

/**
 * Choose the extraction schema from the objective's outcome + domain.
 *  - procedure → step schema
 *  - answer    → general (informational) schema
 *  - candidates → a specific provider schema if the domain is known, else the
 *    generic provider schema (so bike shops / campsites / clinics still get
 *    provider columns rather than the generic summary/detail columns).
 */
export function schemaFor(
  domain: TaskConstraints["domain"],
  outcome?: TaskConstraints["outcome"]
): DomainSchema {
  if (outcome === "procedure") return DOMAIN_SCHEMAS.howto;
  if (outcome === "answer") return DOMAIN_SCHEMAS.general;
  if (outcome === "candidates") {
    if (domain === "instructors" || domain === "restaurants" || domain === "products" || domain === "flights") {
      return DOMAIN_SCHEMAS[domain];
    }
    return GENERIC_CANDIDATE_SCHEMA;
  }
  return DOMAIN_SCHEMAS[domain] ?? DOMAIN_SCHEMAS.general;
}
