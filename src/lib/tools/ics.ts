// Local iCalendar (.ics) generation — a genuinely FREE, real action.
//
// Producing a standards-compliant VCALENDAR needs no external service, so Volo
// can actually perform this one: on approval it hands back an .ics file the user
// imports into any calendar app. No network, no account, no cost.

export interface IcsEvent {
  title: string;
  /** ISO-ish start; if no time is known, an all-day date is used. */
  start?: Date;
  durationMinutes?: number;
  location?: string;
  description?: string;
}

function pad(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

/** Format a Date as a UTC iCalendar timestamp (YYYYMMDDTHHMMSSZ). */
function toIcsUtc(d: Date): string {
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/**
 * Build a valid single-event .ics string. `stamp` (DTSTAMP / UID time) must be
 * passed in — the engine provides it — so this stays deterministic/pure.
 */
export function makeIcs(event: IcsEvent, stamp: Date): string {
  const start = event.start ?? stamp;
  const end = new Date(start.getTime() + (event.durationMinutes ?? 60) * 60_000);
  const uid = `volo-${toIcsUtc(stamp)}-${Math.abs(hash(event.title))}@volo.local`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Volo//Objective Engine//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toIcsUtc(stamp)}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${esc(event.title)}`,
    event.location ? `LOCATION:${esc(event.location)}` : "",
    event.description ? `DESCRIPTION:${esc(event.description)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
