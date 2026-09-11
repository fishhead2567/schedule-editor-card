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

export interface CardConfig {
  type: string;
  title?: string;
  entities?: string[];
}

// Minimal slice of the HA frontend's hass object this card relies on.
export interface HomeAssistant {
  states: Record<string, { entity_id: string; state: string; attributes: Record<string, unknown> }>;
  connection: {
    sendMessagePromise: <T = unknown>(msg: Record<string, unknown>) => Promise<T>;
  };
  locale?: { language?: string };
}
