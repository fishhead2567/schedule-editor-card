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

## Pairing with an automation

This card intentionally does not know about switches, lights, or conditions
— a `schedule` entity is just a weekly on/off signal. Pair it with a small
blueprint automation that keeps a target entity in sync with the schedule's
state, triggered both on the schedule changing and on Home Assistant startup
(so it self-corrects instead of getting stuck if HA was down through a
boundary). That pattern isn't part of this repo (it's just a normal
automation), but it's the piece that makes the schedule actually do
something.

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
