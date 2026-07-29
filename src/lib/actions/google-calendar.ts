// Real calendar event creation via a user's connected Google Calendar (Calendar API).
//
// Enabled only when the user connected Google with the calendar.events scope. Uses
// the per-user encrypted OAuth token (auto-refreshed) — never exposed to the client
// or the model. Creates a REAL event (mode "live") and may honestly say "created".
// Still gated behind explicit approval by the engine. If the requested date can't be
// resolved to a concrete calendar date, it returns requires_user (never guesses).

import type { ActionResult } from "@/lib/types";
import type { ActionInput, ActionProvider } from "./types";
import { currentUserId } from "@/lib/auth/context";
import { getAccessToken, integrationHasScope } from "@/lib/auth/integrations";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/** Has the current user connected Google Calendar with event-write permission? */
export function googleCalendarConfigured(): boolean {
  return integrationHasScope(currentUserId(), "google", CALENDAR_SCOPE);
}

// ── deterministic natural-date resolution (domain-agnostic, no situation logic) ──
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function atMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Resolve a free-text date ("tomorrow", "next friday", "2026-08-01", "Aug 3") to a
 *  local calendar Date at midnight — or null if it can't be resolved confidently. */
export function resolveDate(dateStr: string, now: Date): Date | null {
  const s = (dateStr || "").trim().toLowerCase();
  if (!s) return null;
  const base = atMidnight(now);

  if (/^today$/.test(s)) return base;
  if (/^tomorrow$/.test(s)) return new Date(base.getTime() + 864e5);
  if (/^(day after tomorrow|overmorrow)$/.test(s)) return new Date(base.getTime() + 2 * 864e5);

  // "next monday" / "this friday" / bare weekday
  const wd = s.match(/^(?:(next|this)\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*$/);
  if (wd) {
    const target = WEEKDAYS.findIndex((d) => d.startsWith(wd[2]));
    if (target >= 0) {
      let delta = (target - base.getDay() + 7) % 7;
      if (wd[1] === "next") delta = delta === 0 ? 7 : delta + (delta <= 0 ? 7 : 0);
      if (delta === 0 && wd[1] !== "this") delta = 7; // a bare weekday means the upcoming one
      return new Date(base.getTime() + delta * 864e5);
    }
  }

  // ISO yyyy-mm-dd
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  // m/d or m/d/yyyy
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slash) {
    const yr = slash[3] ? (slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3])) : now.getFullYear();
    return new Date(yr, Number(slash[1]) - 1, Number(slash[2]));
  }

  // "aug 3" / "3 aug" / "august 3rd 2026"
  const mName = s.match(/(?:^|\b)([a-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$/) || s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,})\.?(?:,?\s*(\d{4}))?$/);
  if (mName) {
    const isDayFirst = /^\d/.test(mName[1]);
    const monTok = (isDayFirst ? mName[2] : mName[1]).slice(0, 3);
    const day = Number(isDayFirst ? mName[1] : mName[2]);
    const mon = MONTHS.indexOf(monTok);
    const yr = Number(mName[3]) || now.getFullYear();
    if (mon >= 0 && day >= 1 && day <= 31) {
      const d = new Date(yr, mon, day);
      // If a bare month/day already passed this year, assume next year.
      if (!mName[3] && d.getTime() < base.getTime()) d.setFullYear(yr + 1);
      return d;
    }
  }
  return null;
}

/** Parse a time like "3pm", "3:30 pm", "15:00" → {h, m} in 24h, or null. */
export function resolveTime(timeStr: string): { h: number; m: number } | null {
  const s = (timeStr || "").trim().toLowerCase();
  if (!s) return null;
  const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (ampm[3] === "pm") h += 12;
    return { h, m: Number(ampm[2] || 0) };
  }
  const h24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    const h = Number(h24[1]);
    const m = Number(h24[2]);
    if (h < 24 && m < 60) return { h, m };
  }
  return null;
}

function localOffset(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}
function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function rfc3339Local(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${localOffset(d)}`;
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Build the Calendar API event body (timed 1h event, or all-day if no time). */
export function buildEventTimes(day: Date, time: { h: number; m: number } | null): { start: Record<string, string>; end: Record<string, string> } {
  if (time) {
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.h, time.m, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return { start: { dateTime: rfc3339Local(start) }, end: { dateTime: rfc3339Local(end) } };
  }
  const endDay = new Date(day.getTime() + 864e5);
  return { start: { date: ymd(day) }, end: { date: ymd(endDay) } };
}

export class GoogleCalendarAction implements ActionProvider {
  readonly capability = "calendar_event" as const;
  readonly name = "google-calendar";

  async available(): Promise<boolean> {
    return googleCalendarConfigured();
  }

  validate(input: ActionInput): { ok: boolean; error?: string } {
    if (!String(input.payload.title || input.summary).trim()) return { ok: false, error: "No event title." };
    return { ok: true };
  }

  async execute(input: ActionInput): Promise<ActionResult> {
    const uid = currentUserId();
    const token = await getAccessToken(uid, "google");
    if (!token) {
      return { status: "requires_user", message: "Your Google Calendar connection needs to be re-authorized. Reconnect Google in Settings → Integrations, then try again. Nothing was created.", at: Date.now() };
    }

    const day = resolveDate(String(input.payload.date || ""), new Date());
    if (!day) {
      // Never guess a date — that could create a real event on the wrong day.
      return { status: "requires_user", message: `Couldn't understand the date "${String(input.payload.date || "")}". Tell me an exact date (e.g. "2026-08-01" or "next Friday") and I'll create the event. Nothing was created.`, at: Date.now() };
    }
    const time = resolveTime(String(input.payload.time || ""));
    const { start, end } = buildEventTimes(day, time);

    const body = {
      summary: String(input.payload.title || input.summary).slice(0, 200),
      description: input.summary || undefined,
      location: input.payload.location ? String(input.payload.location) : undefined,
      start,
      end,
    };

    try {
      const res = await fetch(CALENDAR_API, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; htmlLink?: string; error?: { message?: string } };
      if (res.ok && data.id) {
        const when = time ? `${ymd(day)} ${pad(time.h)}:${pad(time.m)}` : `${ymd(day)} (all day)`;
        return { status: "succeeded", mode: "live", confirmation: data.id, message: `Created "${body.summary}" in your Google Calendar for ${when}.${data.htmlLink ? ` ${data.htmlLink}` : ""}`, at: Date.now() };
      }
      return { status: "failed", message: `Google Calendar rejected the event: ${data.error?.message || `HTTP ${res.status}`}. Nothing was created.`, at: Date.now() };
    } catch (e) {
      return { status: "failed", message: `Couldn't reach Google Calendar: ${e instanceof Error ? e.message : "network error"}. Nothing was created.`, at: Date.now() };
    }
  }
}
