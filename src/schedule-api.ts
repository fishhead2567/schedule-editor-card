import { HomeAssistant, ScheduleDays, ScheduleRecord, WEEKDAYS } from "./types";

/**
 * HA's websocket connection (home-assistant-js-websocket) rejects
 * sendMessagePromise with the raw `{code, message}` error object from the
 * response, not an Error instance - so `e instanceof Error` is false and
 * `String(e)` yields "[object Object]" for the exact errors this card most
 * needs to surface (e.g. the native schedule domain's overlap rejection).
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e);
}

export function emptyDays(): ScheduleDays {
  return {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  };
}

export async function listSchedules(hass: HomeAssistant): Promise<ScheduleRecord[]> {
  return hass.connection.sendMessagePromise<ScheduleRecord[]>({ type: "schedule/list" });
}

export async function createSchedule(
  hass: HomeAssistant,
  name: string,
  icon: string | undefined,
  days: ScheduleDays
): Promise<ScheduleRecord> {
  return hass.connection.sendMessagePromise<ScheduleRecord>({
    type: "schedule/create",
    name,
    icon,
    ...days,
  });
}

export async function updateSchedule(
  hass: HomeAssistant,
  scheduleId: string,
  name: string,
  icon: string | undefined,
  days: ScheduleDays
): Promise<ScheduleRecord> {
  return hass.connection.sendMessagePromise<ScheduleRecord>({
    type: "schedule/update",
    schedule_id: scheduleId,
    name,
    icon,
    ...days,
  });
}

export async function deleteSchedule(hass: HomeAssistant, scheduleId: string): Promise<void> {
  await hass.connection.sendMessagePromise({ type: "schedule/delete", schedule_id: scheduleId });
}

export function daysOf(record: ScheduleRecord): ScheduleDays {
  const out = emptyDays();
  for (const day of WEEKDAYS) {
    out[day] = record[day] ?? [];
  }
  return out;
}
