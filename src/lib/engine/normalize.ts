// ─────────────────────────────────────────────────────────────────────────────
// Generic objective normalization — the FIRST stage of understanding.
//
// Users type fast: abbreviations ("tmrw", "appt"), common misspellings ("calender"),
// and chat shorthand. Intent classification / action detection should not fail just
// because of a typo. This canonicalizes a small, GENERIC dictionary of shorthand +
// misspellings (time words, scheduling/calendar/meeting vocabulary, a few safe
// chat abbreviations) BEFORE routing — it is NOT a list of specific phrases and no
// domain/situation is hardcoded.
//
// VERBATIM SAFETY: content the user quoted (e.g. an email body or a quoted event
// title) is left byte-for-byte untouched — only the command language AROUND quotes
// is normalized. So "send bob \"see u tmrw\"" keeps the body exactly as typed.
// ─────────────────────────────────────────────────────────────────────────────

// key (lowercase token) → canonical replacement. Whole-word only.
const CANON: Record<string, string> = {
  // time
  tmrw: "tomorrow",
  tmr: "tomorrow",
  tmrrw: "tomorrow",
  tomorow: "tomorrow",
  tommorow: "tomorrow",
  tommorrow: "tomorrow",
  "2moro": "tomorrow",
  "2morrow": "tomorrow",
  "2mrw": "tomorrow",
  tdy: "today",
  "2day": "today",
  tonite: "tonight",
  yesterdy: "yesterday",
  yestrday: "yesterday",
  wkend: "weekend",
  weeknd: "weekend",
  nxt: "next",
  mrng: "morning",
  aftrnoon: "afternoon",
  // calendar / scheduling vocabulary (misspellings + abbreviations)
  calender: "calendar",
  calandar: "calendar",
  calendr: "calendar",
  calndar: "calendar",
  calenndar: "calendar",
  schedual: "schedule",
  shedule: "schedule",
  scheduel: "schedule",
  apointment: "appointment",
  appointmnt: "appointment",
  appt: "appointment",
  mtg: "meeting",
  meetng: "meeting",
  reminer: "reminder",
  remindr: "reminder",
  evnt: "event",
  // a few safe generic shorthands
  pls: "please",
  plz: "please",
};

// Quoted spans (straight + smart quotes) are verbatim user content — never touched.
const QUOTED = /"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’/g;

function normalizeWords(text: string): string {
  // Tokens may start with a digit ("2moro") — map by lowercase, else pass through.
  return text.replace(/[A-Za-z0-9][A-Za-z0-9'’]*/g, (w) => {
    const repl = CANON[w.toLowerCase()];
    return repl ?? w;
  });
}

/** Canonicalize shorthand/misspellings outside quoted spans. Idempotent + generic. */
export function normalizeObjective(input: string): string {
  if (!input) return input;
  let out = "";
  let last = 0;
  for (const m of input.matchAll(QUOTED)) {
    out += normalizeWords(input.slice(last, m.index));
    out += m[0]; // keep the quoted span exactly
    last = m.index + m[0].length;
  }
  out += normalizeWords(input.slice(last));
  return out;
}
