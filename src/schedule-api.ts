import { HomeAssistant, ScheduleDays, ScheduleRecord, WEEKDAYS } from "./types";

/**
 * Neither of HA's two error shapes this card runs into are Error instances:
 * - hass.connection.sendMessagePromise rejects with the raw `{code, message}`
 *   object from the websocket response (e.g. the schedule domain's overlap
 *   rejection).
 * - hass.callApi rejects with `{error, status_code, body: {message}}` (e.g.
 *   the automation config REST endpoints used for entity bindings).
 * `e instanceof Error` is false for both, so `String(e)` would yield
 * "[object Object]" for exactly the errors most worth surfacing.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null) {
    const obj = e as { message?: unknown; body?: { message?: unknown } };
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.body?.message === "string") return obj.body.message;
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
