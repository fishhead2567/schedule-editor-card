import { GroupedBlock, HomeAssistant, ScheduleDays, ScheduleRecord, WEEKDAYS } from "./types";

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

/**
 * A cheap fingerprint of every schedule.* entity's state - used to notice
 * "something about the schedules changed" (one created/deleted elsewhere,
 * or a block edited from another card/tab) purely from the `hass` object
 * every card already receives on each state change, without polling
 * `schedule/list` on a timer. Compared across `hass` updates; a change
 * means it's worth re-fetching the full block data (not in `hass.states`)
 * via `listSchedules`.
 */
export function scheduleEntitiesFingerprint(hass: HomeAssistant): string {
  return Object.keys(hass.states)
    .filter((id) => id.startsWith("schedule."))
    .sort()
    .map((id) => {
      const s = hass.states[id];
      return `${id}:${s.state}:${JSON.stringify(s.attributes)}`;
    })
    .join("|");
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

/**
 * Regroups a schedule's per-day blocks by exact {from, to} identity - see
 * GroupedBlock in types.ts for why. Two blocks group together only if their
 * times match exactly; a block that's one minute off on one day is a
 * separate group, not merged, which is the correct behavior (it really is
 * a different time range, not a rendering quirk).
 */
export function groupedBlocks(record: ScheduleRecord): GroupedBlock[] {
  const days = daysOf(record);
  const byKey = new Map<string, GroupedBlock>();
  for (const day of WEEKDAYS) {
    for (const block of days[day]) {
      const key = `${block.from}|${block.to}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.days.push(day);
      } else {
        byKey.set(key, { from: block.from, to: block.to, days: [day] });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.from.localeCompare(b.from));
}
