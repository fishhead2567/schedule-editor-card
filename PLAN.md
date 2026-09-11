# Schedule Editor Card — Project Plan

Living planning document. Update this when scope, status, or decisions change —
don't let it drift out of sync with reality. Repo:
https://github.com/fishhead2567/schedule-editor-card

## Why this exists

Context from the conversation that started this project (Home Assistant
irrigation control, 2026-09-10/11):

- The user needed flexible watering schedules (variable times, changing
  cadence) and wanted a GUI-first way to manage them — not YAML, not "a ton
  of input helpers."
- **Irrigation Unlimited** (already installed) is YAML-only (`config_flow:
  false` in its manifest) — no UI for adding/editing zones or schedules.
- **Scheduler Component** (nielsfaber, HACS) looked like the GUI answer but
  turned out to be purely trigger/event-based: it fires an action once at a
  configured time and has no mechanism to reconcile state after Home
  Assistant has been offline through a scheduled boundary. Verified this
  the hard way — built an automation on it, the "off" action silently never
  got added by the UI's "scheme mode" (contrary to assumption), and even
  after fixing that, the underlying execution model still can't self-correct
  a switch left in the wrong state across downtime.
- **HA's native `schedule` helper domain**, by contrast, computes its on/off
  `state` live from the clock — continuously, not from a queued trigger.
  Verified empirically: editing a schedule's block to cover "right now"
  flips its state immediately with no event needed. Paired with a small
  blueprint automation (trigger on schedule state change AND
  `homeassistant, event: start`), this was proven — by deliberately forcing
  the target switch into the wrong state and confirming the automation
  corrected it — to be restart-safe in both directions.
- **Gap**: nothing edits native `schedule.*` entities from a dashboard.
  Settings → Helpers → Schedule is one-at-a-time and clunky. Surveyed the
  real alternatives (nielsfaber/scheduler-card — wrong backend;
  Pulpyyyy/schedule-state-card — wrong backend, read-only anyway;
  amitfin/daily_schedule — no weekly support, its own README says to use
  native `schedule` for that) — confirmed nothing fills this gap.

So: this card exists to be the missing GUI for the *correct, restart-safe*
scheduling primitive, not to replace it with something flashier but weaker.

**Non-goal**: this card does not know about switches, lights, or conditions.
A `schedule` entity is just a weekly on/off signal. Wiring that signal to an
actual device is the separate blueprint-automation concern described above —
intentionally decoupled (see Phase 2 for why that might change).

## Architecture decisions (and why)

| Decision | Alternative considered | Why this way |
|---|---|---|
| TypeScript + Lit | Plain JS custom element | User's explicit choice; matches ecosystem convention (scheduler-card, most serious HACS cards) |
| esbuild bundler | Rollup | Simpler config for a single-file bundle; Rollup is more common in this ecosystem but esbuild output is equivalent and much less to maintain |
| HACS "plugin" (frontend) category, GitHub Releases distribution | Committing `dist/` to the repo | Standard HACS pattern; `hacs.json` `filename` points at a release asset, keeps built output out of git history |
| Disposable Docker HA instance for dev/test | Testing against the user's real HAOS box | Never touch production; instance is fully scriptable and disposable (`docker compose down -v`) |
| Vitest for pure logic only, manual+scripted browser testing for rendering | A full automated UI test suite | Honest match to how HACS frontend cards actually get tested in practice — see [Testing strategy](#testing-strategy) |

## Status as of 2026-09-11 (end of initial build session)

**Done and verified:**
- Repo scaffolded, public, pushed: `fishhead2567/schedule-editor-card`.
- Core card (`src/schedule-editor-card.ts`): list schedules, per-schedule
  weekly timeline (7-day bars), live "now" cursor on today's row, "Idle"/
  "Active now" state pill, create/duplicate/delete a schedule, click a day
  row to open an inline editor (list existing blocks with remove ×, add a
  block via two time inputs).
- Pure logic (`time-utils.ts`: minute math, overlap detection) unit-tested
  with vitest, 8/8 passing.
- `npm run typecheck` / `lint` / `build` all clean.
- **CI green on GitHub Actions** (`.github/workflows/ci.yml`, run
  [34552958336](https://github.com/fishhead2567/schedule-editor-card/actions/runs/34552958336)):
  typecheck, lint, test, build all pass on push to `master`.
- Release workflow written (`.github/workflows/release.yml`) — builds and
  attaches `dist/schedule-editor-card.js` to a GitHub Release on `v*` tag
  push. **Not yet exercised** — no tag cut yet (see Milestone 2).
- Dev harness (`dev/docker-compose.yml`, `dev/seed-schedules.mjs`) built and
  used for real: spun up `ghcr.io/home-assistant/home-assistant:stable` on
  `localhost:8124`, scripted onboarding via the REST API (no manual
  clicking), seeded 4 fixture schedules (empty, single daily block,
  multi-block on specific weekdays, near-midnight block).
- **End-to-end verified in a real headless browser** (Puppeteer, installed
  ad hoc for this session — not part of the repo/CI):
  - Card renders correctly for all 4 fixtures, correct per-day blocks,
    correct icons, live "now" line positioned correctly on today's column
    across every schedule row. Screenshot taken and shown to the user.
  - Full interactive round-trip: clicked a day row in the actual rendered
    DOM (through Lit's shadow root), filled the time inputs, clicked "Add",
    confirmed both that the UI updated AND that `schedule/list` on the
    server reflects the new block. This is the real create/edit path
    working, not just a static render.
- Gotcha discovered and worked around: this HA version defaults fresh users
  to a `/home/overview` panel that silently overrides direct navigation to
  the anonymous default Lovelace dashboard. Named dashboards
  (`lovelace/dashboards/create` with a `url_path`) aren't subject to this
  and are the reliable way to reach a specific view — worth remembering for
  any future scripted HA UI testing.

**Not done yet:**
- No `v0.1.0` tag cut, so the release workflow has never actually run and
  HACS custom-repository install has never been tried end-to-end.
- No editing of an *existing* block's times (only add new / remove existing)
  — no click-to-edit or drag-to-resize.
- No overlap check against blocks already saved server-side beyond the
  client-side `hasOverlap` pre-check (the native `schedule` domain may also
  reject overlaps itself server-side — not yet confirmed what error shape
  that produces, so the card doesn't handle it explicitly).
- No handling of the `icon` field being changed after creation (set once at
  create time, no rename/re-icon affordance).
- No visual editor (`getConfigElement`) for the card's own YAML config in
  HA's dashboard UI — currently config is `entities` (optional list) only,
  hand-typed in YAML mode.
- No mobile/narrow-viewport check.
- No dark-theme check (styles use HA's CSS custom properties, e.g.
  `--divider-color`, `--state-active-color`, which *should* theme correctly
  but this hasn't been visually confirmed in dark mode).
- No accessibility pass (keyboard nav into the day-row editor, ARIA labels).
- README's HACS installation instructions are written but unverified — HACS
  custom-repository add-and-install flow has not actually been exercised.
- `dev/config/` (the throwaway HA instance's config, currently running at
  the time of writing) still exists on disk at
  `~/best_data/projects/ha-schedule-editor-card/dev/config/` — gitignored,
  fine to delete any time with `docker compose -f dev/docker-compose.yml
  down -v`.
- Phase 2 (see below) not started at all.

## Milestones

### Milestone 1 — Core editor (mostly done)
Goal: a working, tested, CI-green schedule CRUD card.
- [x] Scaffold repo, tooling, CI.
- [x] Card renders schedules + weekly timeline + now-cursor.
- [x] Create / duplicate / delete a schedule.
- [x] Add / remove a block on a day.
- [x] Unit tests for time/overlap math.
- [x] Verified rendering + interaction against a real disposable HA instance.
- [ ] Edit an existing block's times in place (not just add new / delete).
- [ ] Confirm/handle server-side overlap rejection gracefully (currently
      only pre-checked client-side).
- [ ] Dark theme visual check.
- [ ] Narrow-viewport (phone width) visual check.

### Milestone 2 — First real release
Goal: prove the actual HACS distribution path works, not just CI.
- [ ] Tag `v0.1.0`, confirm `release.yml` produces a GitHub Release with
      `schedule-editor-card.js` attached.
- [ ] Install it via HACS "custom repository" on the **dev Docker instance**
      (not production) and confirm it installs/loads/updates correctly
      through the real HACS UI flow, not just a manually-mounted file.
- [ ] Only after that's confirmed working: consider installing on the
      user's real HA instance (192.168.1.206) as a custom repository.

### Milestone 3 — Polish
- [ ] Visual config editor (`getConfigElement`) so the card can be added
      through the dashboard UI picker without hand-written YAML.
- [ ] Edit-in-place for existing blocks.
- [ ] Basic accessibility pass.
- [ ] Consider drag-to-create/resize on the timeline bars (nice-to-have,
      not required — click + time-inputs already works).

### Milestone 4 — Phase 2 (optional, do not start before Milestones 1-3 are settled and the user has actually lived with the plain schedule editor for a while)
Goal: let one card row also show/edit the *paired* automation (target
entity + condition), closing the loop back to the user's original mockup
(group + duration + start time + day pills, one card).
- Needs a linking convention between a `schedule.*` entity and the
  blueprint-automation instance that syncs it to a target (e.g. naming
  convention, or an automation search by `use_blueprint.path` +
  `input.schedule_entity` match).
- Reads/writes the automation's `use_blueprint.input` via
  `/api/config/automation/config/{id}` (already proven to work, from the
  original HA-instance session).
- Needs a "create schedule + create bound automation" combined flow.
- **Explicitly deferred** — adds real cross-domain complexity; only worth
  it if Milestone 1-3's plain schedule editor isn't sufficient on its own
  after real use.

## Testing strategy

Matches how HACS frontend cards are actually tested in practice (there is
no established automated-UI-testing convention in this ecosystem):

1. **Unit tests (`npm test`, vitest)** — pure logic only: time parsing,
   percent-of-day math, overlap detection. Fast, run in CI on every push.
2. **Manual/scripted testing against the disposable dev instance**
   (`dev/docker-compose.yml`) — this is where rendering and interaction
   actually get exercised. The Puppeteer scripts used during initial
   verification were **not** committed to the repo (they were throwaway,
   written ad hoc in `/tmp` scratch space) — if headless-browser
   verification becomes a recurring need, consider formalizing a
   `dev/verify.mjs` script committed to the repo, but don't build that
   speculatively before it's actually needed again.
3. **CI (`ci.yml`)** — typecheck + lint + unit tests + build on every push/PR.
   Catches build breaks and logic regressions; does not (and is not
   expected to) catch rendering regressions.
4. **Release verification (Milestone 2)** — the one thing CI can't prove is
   that HACS can actually install this. That has to be checked by hand,
   once, against the dev instance, after a real tag/release exists.

Key operational notes for whoever (human or future Claude session) resumes
this:
- The native `schedule` domain's websocket API (`schedule/list`,
  `/create`, `/update`, `/delete`) was reverse-engineered and verified
  empirically this session — not documented anywhere officially. Schema:
  top-level `id`/`name`/`icon` plus one array per weekday
  (`monday`...`sunday`), each entry `{from, to}` in `HH:MM:SS`. `update`
  requires the full record (name + icon + all seven day arrays), not a
  partial patch — omitting `name` errors with `required key not provided`.
  Empty-list days must be passed as `[]`, not omitted with an empty
  `conditions`-style value (that specific gotcha was for a *different* API —
  the Scheduler Component's `/api/scheduler/edit` — but the lesson "don't
  guess, check what the schema actually rejects" applies here too).
- To reach a specific dashboard view when scripting against a **fresh** HA
  instance, create a **named** dashboard (`lovelace/dashboards/create` with
  a `url_path`) rather than overwriting the anonymous default one — the
  default gets overridden by this HA version's `/home/overview` panel for
  fresh/uncustomized users, silently redirecting direct navigation.
- Scripted onboarding (no manual browser clicking needed) is:
  `POST /api/onboarding/users` → exchange the returned `auth_code` at
  `POST /auth/token` → `POST /api/onboarding/{core_config,analytics,integration}`
  with that bearer token → mint a real long-lived token via the websocket
  `auth/long_lived_access_token` command.
- Puppeteer needs `yauzl` as a dependency in the same project if the sandbox
  has no `unzip` binary — `npx puppeteer browsers install chrome` otherwise
  fails at the extraction step, not the download step (confusing error the
  first time).
- Shadow-DOM traversal in a headless browser must special-case `<slot>`
  elements (`el.assignedElements()`, not `.children`) — HA's own layout
  (`ha-drawer` etc.) projects its main content through slots, so a naive
  recursive `.shadowRoot` walk dead-ends there and silently "finds nothing"
  even though the target element is very much on the page.

## Open risks / things to watch

- The native `schedule` domain's storage schema is undocumented publicly;
  it's been stable since HA 2022.9 per the integration's own docs, but a
  future HA release could change it without much warning. No automated
  contract test guards against this yet — would need a "does `schedule/list`
  still look like X" smoke test, not currently written.
- This card becomes something only this project maintains — there's no
  upstream community keeping it in sync with HA frontend changes the way an
  official integration would be.
- Phase 2, if ever built, meaningfully increases scope (cross-domain state,
  a linking convention, combined create flows) — resist starting it before
  Milestone 1-3 are actually solid and lived-with.
