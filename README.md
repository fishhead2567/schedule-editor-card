# Schedule Editor Card

A Lovelace card for Home Assistant's **native `schedule` helper domain** — create,
edit, duplicate and delete weekly schedules directly from your dashboard, with
day-by-day timeline bars and a live "now" indicator.

![Schedule Editor Card showing four schedules with weekly timeline bars and a live now-indicator](docs/screenshot.png)

Home Assistant's built-in Schedule helper computes its on/off state live from
the clock (not from a one-time trigger), which makes it a good fit for
anything actuating real equipment — it doesn't get stuck in the wrong state
if Home Assistant is restarted or offline through a scheduled boundary. But
the only way to edit one has been the Helpers settings page, one schedule at
a time, with no dashboard view across several. This card fixes that.

This card only edits `schedule.*` entities themselves (the weekly time
blocks). Wiring a schedule's on/off state to an actual switch/light is a
separate concern — see [this pattern](#pairing-with-an-automation) below.

## Installation (HACS)

1. HACS → the three-dot menu → **Custom repositories**.
2. Add this repo's URL, category **Dashboard** (plugin).
3. Install "Schedule Editor Card", then add the resource if HACS doesn't do
   it automatically (Settings → Dashboards → Resources).

## Usage

```yaml
type: custom:schedule-editor-card
title: Schedules
# Optional - omit to show every schedule.* entity that exists.
entities:
  - schedule.new_sod_watering
```

## Controlling entities from a schedule

A `schedule` entity by itself is just a weekly on/off signal — something
still has to flip real entities in response. The card manages that for
you: click the plug icon in a schedule's header to open its **controls**
panel, pick one or more entities (switch or light domain — group helpers
work too, since they're just entities in those same domains), and
optionally set a recheck interval.

Under the hood this creates (and keeps in sync) a small automation built
from a bundled blueprint, `local/schedule_sync.yaml` — restart-safe (it
re-asserts the correct state on schedule transitions, on Home Assistant
startup, and optionally on a fixed interval you choose per schedule) —
deterministically named `schedule_sync_<schedule id>` so the card can
find, update, or remove it without ever asking you to open Settings →
Automations. Deleting a schedule from the card also removes its bound
automation.

**Why an interval, and why off by default:** re-asserting state only at
transitions/startup means a manual override (someone turns a light back
off after the schedule turned it on) sticks until the next real
transition — usually what you want. For something where silent drift
matters more than respecting an override (e.g. a valve left open), set a
recheck interval and it'll be corrected within roughly that many minutes
instead.

You'll need the blueprint itself installed once per Home Assistant
instance: copy [`local/schedule_sync.yaml`](local/schedule_sync.yaml) into
your `config/blueprints/automation/local/` directory. (A one-click My Home
Assistant import link is a nice future improvement, not done yet — see
PLAN.md.)

## Development

### Requirements

- Node 22+
- Docker + Docker Compose (for the disposable test instance)

### Build

```bash
npm install
npm run build       # bundles src/schedule-editor-card.ts -> dist/schedule-editor-card.js
npm run watch        # rebuild on change
npm test             # unit tests (time/block math) via vitest
npm run typecheck
npm run lint
```

### Testing against a real Home Assistant instance (safely)

Never test against your production Home Assistant. This repo includes a
throwaway instance you can nuke and recreate at will:

```bash
npm run build
docker compose -f dev/docker-compose.yml up -d
```

- Open http://localhost:8124 and complete the one-time onboarding (creates
  a local user; none of this touches any other Home Assistant instance).
- Settings → your profile → Security → **Create long-lived access token**.
- Seed some test schedules covering edge cases (empty schedule, single
  block, multiple blocks on specific weekdays, a block near midnight):

  ```bash
  HA_HOST=localhost:8124 HA_TOKEN=<paste> node dev/seed-schedules.mjs
  ```

- Add the card to a dashboard: Settings → Dashboards → Resources → add
  `/local/community/schedule-editor-card/schedule-editor-card.js` as a
  JavaScript module, then add a `custom:schedule-editor-card` card to any
  view.
- Edit `src/`, `npm run build` (or leave `npm run watch` running), refresh
  the browser tab. The dev instance is bind-mounted straight from `dist/`,
  so no re-install step is needed between builds.
- Tear down any time with `docker compose -f dev/docker-compose.yml down -v`
  — this deletes the throwaway instance's config entirely and starts fresh
  next time.

This mirrors how most HACS frontend cards are actually tested in practice:
pure logic (date/time-block math, overlap validation) gets unit tests
(`npm test`); rendering and interaction get exercised by hand against a real
but disposable Home Assistant instance, since there isn't an established
automated-UI-testing convention in this ecosystem.

### Releasing

Push a tag matching `v*` (e.g. `v0.1.0`). The `release.yml` workflow builds
the card and attaches `schedule-editor-card.js` to a GitHub Release, which is
what HACS downloads.

## License

MIT
