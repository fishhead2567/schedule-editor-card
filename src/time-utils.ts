import { ScheduleBlock } from "./types";

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
