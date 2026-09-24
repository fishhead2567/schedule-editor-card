import { AutomationBinding, EntityTarget, HomeAssistant } from "./types";

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
      // string[] here is the pre-issue-#6 shape (a plain entity-id list,
      // from when target_entities was an `entity` selector, not `target`).
      // Normalized to EntityTarget on read - see normalizeTarget().
      target_entities?: EntityTarget | string[];
      skip_on_entities?: string[];
      recheck_interval_minutes?: number;
    };
  };
}

function isNotFound(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { status_code?: number }).status_code === 404;
}

/** Old saved bindings (before issue #6) stored target_entities as a plain
 * entity-id array; new ones store the full EntityTarget shape. Handles
 * both, plus the "never saved" case, so a pre-existing binding displays
 * and re-saves correctly without the user having to redo it by hand. */
function normalizeTarget(value: EntityTarget | string[] | undefined): EntityTarget {
  if (!value) return { entity_id: [] };
  if (Array.isArray(value)) return { entity_id: value };
  return value;
}

export async function getBinding(hass: HomeAssistant, scheduleId: string): Promise<AutomationBinding | null> {
  try {
    const config = await hass.callApi<AutomationConfig>(
      "GET",
      `config/automation/config/${automationIdFor(scheduleId)}`
    );
    const input = config.use_blueprint?.input ?? {};
    return {
      entities: normalizeTarget(input.target_entities),
      recheckMinutes: input.recheck_interval_minutes ?? 0,
      conditionEntities: input.skip_on_entities ?? [],
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
        skip_on_entities: binding.conditionEntities,
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
