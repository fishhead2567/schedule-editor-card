export interface ScheduleBlock {
  from: string; // "HH:MM:SS"
  to: string; // "HH:MM:SS"
}

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export type ScheduleDays = Record<Weekday, ScheduleBlock[]>;

export interface ScheduleRecord extends ScheduleDays {
  id: string;
  name: string;
  icon?: string;
}

/**
 * A schedule's blocks, regrouped: rather than "day is unique, times repeat"
 * (the native storage shape - a block belongs to a day's array), this is
 * "time range is the unit, days are a property of it" - one entry per
 * distinct {from, to} pair, listing which days currently have that exact
 * block. Purely a display/editing convenience computed from the native
 * per-day arrays; the underlying storage format is unchanged.
 */
export interface GroupedBlock {
  from: string;
  to: string;
  days: Weekday[];
}

export interface CardConfig {
  type: string;
  title?: string;
  entities?: string[];
}

/** What a schedule controls: entities on while active, off otherwise, plus
 * how aggressively to keep them in sync between transitions (0 = only at
 * transitions/startup, matching the underlying blueprint's default). */
export interface AutomationBinding {
  entities: string[];
  recheckMinutes: number;
}

// Minimal slice of the HA frontend's hass object this card relies on.
export interface HomeAssistant {
  states: Record<string, { entity_id: string; state: string; attributes: Record<string, unknown> }>;
  connection: {
    sendMessagePromise: <T = unknown>(msg: Record<string, unknown>) => Promise<T>;
  };
  callApi: <T = unknown>(method: string, path: string, parameters?: unknown) => Promise<T>;
  callService: (domain: string, service: string, serviceData?: Record<string, unknown>) => Promise<unknown>;
  locale?: { language?: string };
  /** hass.config.time_zone is the server's configured timezone (Settings ->
   * System -> General) - schedule blocks are evaluated against this, not
   * the browser's own timezone. See currentMinutesInZone/todayWeekdayInZone
   * in time-utils.ts for why every "is this active now" computation must
   * use this instead of a bare `new Date()`. */
  config?: { time_zone?: string };
}
