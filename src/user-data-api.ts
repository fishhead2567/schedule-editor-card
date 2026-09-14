import { HomeAssistant } from "./types";

/**
 * The native schedule domain has no color field, so per-schedule colors
 * are stored via HA's own frontend/get_user_data + frontend/set_user_data
 * websocket commands - the same mechanism HA's frontend uses internally
 * for things like dashboard reorder state. This persists per HA user
 * account, not per browser, unlike localStorage.
 */
const COLORS_KEY = "schedule_editor_card_colors";

/** Used whenever a schedule has no color of its own set yet. */
export const DEFAULT_COLOR = "#2196f3";

export async function getColors(hass: HomeAssistant): Promise<Record<string, string>> {
  const res = await hass.connection.sendMessagePromise<{ value: Record<string, string> | null }>({
    type: "frontend/get_user_data",
    key: COLORS_KEY,
  });
  return res.value ?? {};
}

export async function setColor(hass: HomeAssistant, scheduleId: string, color: string): Promise<Record<string, string>> {
  const current = await getColors(hass);
  const next = { ...current, [scheduleId]: color };
  await hass.connection.sendMessagePromise({ type: "frontend/set_user_data", key: COLORS_KEY, value: next });
  return next;
}
