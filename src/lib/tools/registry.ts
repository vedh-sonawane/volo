// ─────────────────────────────────────────────────────────────────────────────
// Tool abstraction + registry (Phase 8). Every tool declares a name,
// description, input/output schema, permission level, whether it needs approval,
// and how it fails. Research tools run automatically; anything with external
// consequences is gated behind explicit approval (Phase 7).
//
// For the free MVP only tools that can genuinely run at zero cost are marked
// `implemented`. Consequential integrations (send email, submit form, book) are
// declared here as the extension surface but are NOT wired to real side effects.
// ─────────────────────────────────────────────────────────────────────────────

import type { PermissionLevel, ToolName } from "@/lib/types";

export interface ToolSchemaField {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
}

export interface ToolSpec {
  name: ToolName | string;
  description: string;
  input: ToolSchemaField[];
  output: ToolSchemaField[];
  permission: PermissionLevel;
  /** True when running the tool requires explicit user approval first. */
  requiresApproval: boolean;
  /** Whether the tool actually runs for free in this MVP. */
  implemented: boolean;
  /** How the tool behaves on failure (honesty about error handling). */
  onError: string;
}

export const TOOL_REGISTRY: ToolSpec[] = [
  {
    name: "web_search",
    description: "Search the web for relevant pages using the free research provider.",
    input: [{ name: "query", type: "string", description: "Search query" }],
    output: [{ name: "results", type: "array", description: "Ranked {url,title,snippet}" }],
    permission: "research",
    requiresApproval: false,
    implemented: true,
    onError: "Returns an empty result set; the step is marked failed with the reason and the run continues.",
  },
  {
    name: "fetch_page",
    description: "Fetch a public webpage and extract its readable content and links.",
    input: [{ name: "url", type: "string", description: "Absolute http(s) URL" }],
    output: [{ name: "page", type: "object", description: "{title,text,links,words,ok}" }],
    permission: "research",
    requiresApproval: false,
    implemented: true,
    onError: "Marks the page not-ok with an error; other pages still process.",
  },
  {
    name: "extract_structured",
    description: "Turn fetched page content into evidence-backed structured rows.",
    input: [{ name: "columns", type: "array", description: "Columns to extract" }],
    output: [{ name: "items", type: "array", description: "ResultItem[]" }],
    permission: "research",
    requiresApproval: false,
    implemented: true,
    onError: "Rows with no extractable fields are dropped rather than fabricated.",
  },
  {
    name: "compare",
    description: "Filter options by constraints and rank them transparently.",
    input: [
      { name: "maxPrice", type: "number", description: "Upper price bound" },
      { name: "count", type: "number", description: "How many to recommend" },
    ],
    output: [{ name: "comparison", type: "object", description: "Ranked comparison" }],
    permission: "recommend",
    requiresApproval: false,
    implemented: true,
    onError: "If nothing qualifies, returns an empty comparison with an explanation.",
  },
  {
    name: "draft_email",
    description: "Prepare an email draft locally. Does NOT send. Downloadable as .eml.",
    input: [
      { name: "to", type: "string", description: "Recipient" },
      { name: "subject", type: "string", description: "Subject line" },
      { name: "body", type: "string", description: "Body text" },
    ],
    output: [{ name: "draft", type: "object", description: "{to,subject,body,eml}" }],
    permission: "recommend",
    requiresApproval: false,
    implemented: true,
    onError: "Never sends; on failure returns the draft text so nothing is lost.",
  },
  // ── Declared extension surface — intentionally NOT auto-runnable for free ──
  {
    name: "send_email",
    description: "Send an email. Requires a user-provided, free-tier SMTP config and explicit approval.",
    input: [{ name: "draftId", type: "string", description: "Approved draft to send" }],
    output: [{ name: "sent", type: "boolean", description: "Delivery status" }],
    permission: "action",
    requiresApproval: true,
    implemented: false,
    onError: "Not enabled in the free MVP. Volo will only ever create a draft to send manually.",
  },
  {
    name: "submit_form",
    description: "Submit a public web form on the user's behalf.",
    input: [{ name: "url", type: "string", description: "Form endpoint" }],
    output: [{ name: "submitted", type: "boolean", description: "Result" }],
    permission: "action",
    requiresApproval: true,
    implemented: false,
    onError: "Not enabled in the free MVP. Volo prepares the fields for you to review and submit.",
  },
  {
    name: "book",
    description: "Make a booking or reservation (external commitment).",
    input: [{ name: "details", type: "object", description: "Booking details" }],
    output: [{ name: "confirmation", type: "string", description: "Confirmation id" }],
    permission: "action",
    requiresApproval: true,
    implemented: false,
    onError: "Not enabled in the free MVP. Volo hands you the exact steps and link to book.",
  },
];

export function getTool(name: string): ToolSpec | undefined {
  return TOOL_REGISTRY.find((t) => t.name === name);
}
