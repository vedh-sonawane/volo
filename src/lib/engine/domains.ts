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

export function schemaFor(domain: TaskConstraints["domain"]): DomainSchema {
  return DOMAIN_SCHEMAS[domain] ?? DOMAIN_SCHEMAS.general;
}
