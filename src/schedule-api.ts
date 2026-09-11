import { HomeAssistant, ScheduleDays, ScheduleRecord, WEEKDAYS } from "./types";

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
