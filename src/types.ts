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

/** HA's generic "target" shape - entities/devices/areas/labels together,
 * as produced by an `ha-selector`'s `target` selector and accepted
 * natively by an action's `target:` field (which resolves devices/areas/
 * labels to their entities itself - no manual resolution needed on our
 * side for this shape to work as a turn_on/turn_off target). */
export interface EntityTarget {
  entity_id?: string[];
  device_id?: string[];
  area_id?: string[];
  label_id?: string[];
}

/** What a schedule controls: entities (or devices/areas/labels, via
 * EntityTarget) on while active, off otherwise, plus how aggressively to
 * keep them in sync between transitions (0 = only at transitions/startup,
 * matching the underlying blueprint's default).
 * conditionEntities (binary_sensor/input_boolean) additionally gate the ON
 * state: if any are 'on', the target is forced off even during an active
 * block - required (not optional) so getBinding/saveBinding staying in
 * sync is a compile-time property, not something that can silently drift.
 * conditionEntities is deliberately still a plain entity list, not an
 * EntityTarget: the condition check needs is_state() per entity in Jinja,
 * and label_entities() there only resolves labels applied directly to
 * entities (not rolled up through a device/area's label) - unlike a
 * target: field, which resolves all of that natively. Mixing that
 * asymmetric behavior into the condition picker would be a silent
 * footgun, so it's out of scope here (see issue #6's discussion). */
export interface AutomationBinding {
  entities: EntityTarget;
  recheckMinutes: number;
  conditionEntities: string[];
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
