import { ScheduleBlock, WEEKDAYS, Weekday } from "./types";

/** Parse "HH:MM:SS" or "HH:MM" into minutes since midnight. */
export function toMinutes(hms: string): number {
  const parts = hms.split(":").map((p) => parseInt(p, 10));
  const [h, m] = parts;
  return h * 60 + (m || 0);
}

export function minutesToHM(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Percentage (0-100) of the day elapsed at this time, for CSS positioning. */
export function percentOfDay(hms: string): number {
  return (toMinutes(hms) / 1440) * 100;
}

/**
 * True if two blocks overlap. A block whose `to` is <= `from` is treated as
 * spanning midnight (open-ended for this check, since the native schedule
 * domain itself forbids overlaps and this is only used for pre-submit
 * client-side validation, not as a source of truth).
 */
export function blocksOverlap(a: ScheduleBlock, b: ScheduleBlock): boolean {
  const aStart = toMinutes(a.from);
  const aEnd = toMinutes(a.to) || 1440;
  const bStart = toMinutes(b.from);
  const bEnd = toMinutes(b.to) || 1440;
  return aStart < bEnd && bStart < aEnd;
}

export function hasOverlap(blocks: ScheduleBlock[]): boolean {
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      if (blocksOverlap(blocks[i], blocks[j])) return true;
    }
  }
  return false;
}

export function currentMinutesOfDay(now = new Date()): number {
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Home Assistant evaluates schedule blocks against the *server's*
 * configured timezone (Settings -> System -> General), not the browser's -
 * confirmed the hard way earlier in this project (a schedule set to
 * activate at a specific time stayed Idle because the two zones disagreed).
 * Anything computing "is this block active right now" or "what day is
 * today" for display has to agree with that same server zone, or the
 * card can visibly disagree with the schedule entity's own real state.
 * `hass.config.time_zone` is where the server's zone is exposed to cards;
 * falls back to the browser's own zone if it's ever unavailable rather
 * than throwing.
 */
export function currentMinutesInZone(timeZone: string | undefined, now = new Date()): number {
  const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

export function todayWeekdayInZone(timeZone: string | undefined, now = new Date()): Weekday {
  const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const label = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long" }).format(now).toLowerCase();
  return (WEEKDAYS as readonly string[]).includes(label) ? (label as Weekday) : "monday";
}

/** Pure day-of-week arithmetic - no Date/timezone math needed, since
 * schedule blocks are keyed by weekday only, not by calendar date. */
export function addDaysToWeekday(weekday: Weekday, offset: number): Weekday {
  const index = WEEKDAYS.indexOf(weekday);
  const next = (((index + offset) % 7) + 7) % 7;
  return WEEKDAYS[next];
}

/**
 * A cosmetic "Sep 15" label for today+offset, computed in the server's
 * timezone's calendar (not the browser's) so e.g. "tomorrow" always means
 * the day that will actually follow in the zone the schedules run in.
 * Built with a UTC-anchored Date purely as a calendar-math scratchpad
 * (never converted through any real timezone) to get correct month/year
 * rollovers for free from the platform Date implementation.
 */
export function dateLabelForOffset(timeZone: string | undefined, offset: number, now = new Date()): string {
  const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const scratch = new Date(Date.UTC(get("year"), get("month") - 1, get("day") + offset));
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(scratch);
}
