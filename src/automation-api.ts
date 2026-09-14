import { AutomationBinding, HomeAssistant } from "./types";

/**
 * A schedule entity is just an on/off signal; something has to actually
 * flip real entities in response. That "something" is an automation built
 * from the local/schedule_sync.yaml blueprint (restart-safe: re-asserts
 * state on schedule transitions, HA startup, and an optional periodic
 * recheck - see PLAN.md). This module owns the deterministic link between
 * a schedule and its automation so the card can create/read/update/delete
 * it without the user ever opening Settings -> Automations.
 */
const BLUEPRINT_PATH = "local/schedule_sync.yaml";

export function automationIdFor(scheduleId: string): string {
  return `schedule_sync_${scheduleId}`;
}

interface AutomationConfig {
  alias?: string;
  use_blueprint?: {
    path: string;
    input?: {
      schedule_entity?: string;
      target_entities?: string[];
      skip_on_entities?: string[];
      recheck_interval_minutes?: number;
    };
  };
}

function isNotFound(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { status_code?: number }).status_code === 404;
}

export async function getBinding(hass: HomeAssistant, scheduleId: string): Promise<AutomationBinding | null> {
  try {
    const config = await hass.callApi<AutomationConfig>(
      "GET",
      `config/automation/config/${automationIdFor(scheduleId)}`
    );
    const input = config.use_blueprint?.input ?? {};
    return {
      entities: input.target_entities ?? [],
      recheckMinutes: input.recheck_interval_minutes ?? 0,
    };
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

export async function saveBinding(
  hass: HomeAssistant,
  scheduleId: string,
  scheduleName: string,
  binding: AutomationBinding
): Promise<void> {
  const config: AutomationConfig = {
    alias: `Schedule sync: ${scheduleName}`,
    use_blueprint: {
      path: BLUEPRINT_PATH,
      input: {
        schedule_entity: `schedule.${scheduleId}`,
        target_entities: binding.entities,
        skip_on_entities: [],
        recheck_interval_minutes: binding.recheckMinutes,
      },
    },
  };
  await hass.callApi("POST", `config/automation/config/${automationIdFor(scheduleId)}`, config);
  // The automation platform only picks up new/changed blueprint-based
  // automations on reload - same requirement discovered (and worked around)
  // when this blueprint was first built. See PLAN.md's Milestone 4 notes.
  await hass.callService("automation", "reload");
}

export async function deleteBinding(hass: HomeAssistant, scheduleId: string): Promise<void> {
  try {
    await hass.callApi("DELETE", `config/automation/config/${automationIdFor(scheduleId)}`);
    await hass.callService("automation", "reload");
  } catch (e) {
    if (isNotFound(e)) return;
    throw e;
  }
}
