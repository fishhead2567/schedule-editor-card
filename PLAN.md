# Schedule Editor Card — Project Plan

Living planning document. Update this when scope, status, or decisions change —
don't let it drift out of sync with reality. Repo:
https://github.com/fishhead2567/schedule-editor-card

**Operational boundary set 2026-09-11: no further changes to the user's
real Home Assistant instance (192.168.1.206) from this project for the
remainder of this working session.** The Milestone 4 backend changes
(blueprint update) already made there are real and stay in place — this
isn't a rollback, it's a stop-touching-it-further instruction. The user
will start a dedicated session later specifically to integrate this
project's output onto real HA when they're ready for that. Until then,
**all work happens against the disposable Docker dev instance only**
(`dev/docker-compose.yml`, `localhost:8124`) or in the repo itself. If a
future session needs to touch the real instance again, that has to come
from the user, explicitly, in that dedicated session — not assumed from
this plan.

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

**Updated 2026-09-11**: entity selection is no longer a non-goal — it's
Milestone 4 (was "Phase 2"), now firmly in scope, just sequenced after the
plain schedule editor is solid. See Milestone 4 for the design and the
architecture tradeoff it accepts (this will create real `automation.*`
entities under the hood — there's no way around that within HA's execution
model without a much bigger, separate custom-integration project; see that
section for the full reasoning).

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
- Release workflow (`.github/workflows/release.yml`) exercised for real:
  `v0.1.0` tagged and pushed, GitHub Release created with
  `schedule-editor-card.js` attached, asset verified byte-identical to the
  local build.
- HACS's own official validator (`hacs/action`, `.github/workflows/validate.yml`)
  passes 8/8 — added mid-session after the first run caught two real gaps
  (missing README image, missing repo topics), both fixed.
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
- No literal click-through HACS "custom repository" install has been done
  (deliberately — see Milestone 2 for why). The release + HACS-validator
  path that install would rely on is confirmed working.
- ~~No editing of an existing block's times~~ — done, see Milestone 1.
- ~~No overlap check against already-saved blocks~~ — the native domain does
  reject overlaps server-side (confirmed), and the card's error display now
  correctly surfaces that message (was a real bug, now fixed and
  unit-tested) — see Milestone 1. No drag-to-resize still (click + time
  inputs only) — that remains a Milestone 3 nice-to-have, not required.
- ~~No handling of the icon field being changed after creation~~ — done
  2026-09-14, see Milestone 1 addendum below. No rename affordance for the
  schedule's name yet (not asked for; icon was the specific ask).
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
- Milestone 4 (entity selection — on/off entity lists per schedule) not
  started; design finalized 2026-09-11, see that section.

## Milestones

### Milestone 1 — Core editor (done)
Goal: a working, tested, CI-green schedule CRUD card.
- [x] Scaffold repo, tooling, CI.
- [x] Card renders schedules + weekly timeline + now-cursor.
- [x] Create / duplicate / delete a schedule.
- [x] Add / remove a block on a day.
- [x] Unit tests for time/overlap math.
- [x] Verified rendering + interaction against a real disposable HA instance.
- [x] Edit an existing block's times in place — click the pencil icon on a
      block chip, it becomes two inline time inputs + save/cancel. Verified
      live (clicked through the real UI, changed a block's times, confirmed
      the change persisted server-side via `schedule/list`).
- [x] Confirm/handle server-side overlap rejection gracefully — **found a
      real related bug while checking this**: HA's websocket connection
      rejects `sendMessagePromise` with a plain `{code, message}` object,
      not an `Error` instance, so the card's `e instanceof Error ? ... :
      String(e)` pattern would have silently shown "[object Object]" for
      exactly the errors this needed to surface (confirmed the native
      domain does reject overlaps server-side, message: `"Overlapping
      times found in schedule at 'monday'. Got [...]"`, via a direct
      websocket test bypassing the card entirely). Fixed with a shared
      `errorMessage()` helper (`schedule-api.ts`) handling both shapes,
      unit-tested against the exact real error shape. Used everywhere the
      card catches an error, not just the overlap path.
- [x] Dark theme visual check — passes with zero code changes, confirmed by
      screenshot; styling already used HA's CSS custom properties
      throughout (`--divider-color`, `--state-active-color`, etc.) rather
      than hardcoded colors.
- [x] Narrow-viewport (phone width, 390px) visual check — passes with zero
      code changes, confirmed by screenshot; no horizontal overflow or
      cramped controls.
- [x] **(Added 2026-09-14)** Change a schedule's icon after creation —
      clicking the icon in the header now opens `<ha-selector>` with an
      `{icon: {}}` selector (confirmed `ha-icon-picker`/`ha-selector` both
      globally registered before building against them, same as the
      entity-binding work). Verified live: clicked the icon on "Empty
      Schedule," set it to `mdi:leaf` through the actual picker, confirmed
      the change persisted via `schedule/list` and re-rendered correctly.
      Renaming a schedule's name is still not supported — not asked for,
      icon was the specific request.

### Milestone 2 — First real release (done, with one deliberate exception)
Goal: prove the actual HACS distribution path works, not just CI.
- [x] Tag `v0.1.0`, confirm `release.yml` produces a GitHub Release with
      `schedule-editor-card.js` attached — done, asset byte-for-byte matches
      the local build (38861 bytes), filename matches `hacs.json`.
- [x] Repo passes HACS's own official validator (`hacs/action`, category
      `plugin`) — added as a third CI workflow (`validate.yml`), runs on
      every push plus weekly (catches HACS changing its own rules). First
      run correctly caught two real gaps: no image in the README, no repo
      topics. Fixed both (added the verified screenshot to
      `docs/screenshot.png`, set topics `home-assistant`, `hacs`,
      `lovelace`, `lovelace-card`, `home-automation`). Second run: 8/8
      checks pass.
- [ ] **Deliberately not done**: an actual HACS "Add custom repository" →
      install click-through on the dev instance. HACS's setup requires a
      GitHub OAuth device-flow login (visit github.com/login/device, enter
      a code, approve) — there's no API to complete that without a real
      browser session tied to a logged-in GitHub account, and scripting a
      login flow against a real service is exactly the category of action
      this project avoids automating (same reasoning as never scripting
      HA's own username/password login earlier in this work). The
      validator above is the authoritative, correct-for-automation
      substitute — it's the same tool HACS's own maintainers use to gate
      real-world repos. A literal click-through install is a ~60-second
      manual check anyone can do themselves whenever they want the final
      "yes, exactly this button works" confirmation; not worth blocking
      further work on.
- [ ] Only after the user wants to: install on the real HA instance
      (192.168.1.206) as a custom repository — their call, their login.

### Milestone 3 — Polish
- [x] ~~Edit-in-place for existing blocks~~ — moved to and done under
      Milestone 1 (it's core CRUD completeness, not really "polish" in
      hindsight).
- [x] ~~Dark theme / mobile viewport checks~~ — moved to and done under
      Milestone 1 for the same reason.
- [ ] Visual config editor (`getConfigElement`) so the card can be added
      through the dashboard UI picker without hand-written YAML.
- [ ] Basic accessibility pass (this is genuinely UI-facing — hold for the
      user's UI feedback pass rather than guessing at it).
- [ ] Consider drag-to-create/resize on the timeline bars (nice-to-have,
      not required — click + time-inputs already works; also hold for UI
      feedback rather than building speculatively).

### UI feedback round 1 (2026-09-11, real user review of the dev instance)

**Feedback:** the card was too tall — every schedule always rendered its
full 7-row weekly bar grid, most of which is empty gray bar for schedules
active on only 1-2 days. Ask: default to just listing current blocks, put
the visual weekly grid behind a down-arrow/expand toggle, and let clicking
a block go straight to editing it (not click-the-day-row-first, then
find-the-block).

**Fixed** — real layout change (`schedule-editor-card.ts`), not just a
tweak:
- Default view per schedule is now a flat, wrapped list of block chips
  (`Tue 00:20–00:40`, one chip per actual block across the whole week,
  empty days simply don't appear) plus an inline "add block" row (day
  dropdown + two time inputs) — no bars, no empty-day rows, by default.
- A chevron in the schedule header (▸/▾) toggles the full 7-row weekly
  timeline visual on/off, collapsed by default. It's now purely visual
  (no per-day click-to-edit inside it anymore — that would be redundant
  with the flat list, which is always visible above it).
- Clicking a block chip's text directly enters inline edit for that
  specific block (no intermediate day-click step). Verified live: clicked
  a chip in the collapsed default view, changed its end time, saved,
  confirmed the new value via `schedule/list` server-side.
- Result: a 4-schedule card that previously rendered ~28 mostly-empty bar
  rows now renders only as many chips as there are real blocks (8 for the
  busiest fixture) — visibly, substantially shorter, confirmed by
  screenshot.

**Feedback:** "empty schedules are showing a yellow bar for Fridays" —
reported as if it were a data bug (an empty schedule shouldn't show
anything).

**Diagnosis, not a bug:** that was the "now" indicator — it renders on
today's row (the review happened on a Friday) even when the day has zero
blocks, which is correct behavior (you should be able to see where "now"
falls even on an empty day) but was genuinely easy to mistake for a
scheduled block, since it used the same visual language (a colored bar
filling part of the row).

**Fixed:**
- The now-indicator no longer looks like a block at all: it's now a thin
  red line with a small triangle flag at the top — the same visual
  convention as a video-editor playhead or Google Calendar's current-time
  line — clearly a marker, not filled content. Blocks stay in
  `--state-active-color` (blue by default); the marker uses
  `--now-line-color` (falls back to `--error-color`, red) specifically so
  the two are never the same hue.
- It also no longer shows by default at all in the normal collapsed view,
  since that view has no bars — it only appears if you deliberately expand
  a schedule's weekly grid via the chevron, at which point the reviewer
  has already opted into seeing the detailed timeline and the red
  marker's meaning is unambiguous in that context.

All of the above verified against the disposable dev instance
(`localhost:8124`), screenshots taken in light/dark/mobile, real click
interactions driven through the actual rendered shadow DOM (not just
inspecting source) — same rigor as every other claim in this plan.

### Milestone 4 — Entity selection (confirmed in scope 2026-09-11, sequenced after Milestones 1-3)
Goal: let one card row show/edit **one or more entities (including
groups)** that turn on while the schedule is active and off otherwise —
closing the loop back to the user's original mockup (group + duration +
start time + day pills, one card).

**Design — one entity list, not two (corrected 2026-09-11):** an earlier
pass of this section proposed separate `on_entities`/`off_entities` lists.
The user clarified that's not needed — one list is enough, with the fixed
rule "on while active, off otherwise." Simpler, matches the original
blueprint's polarity exactly, just generalized from a single entity to a
list (and confirmed groups work here for free, since a group helper is
just a normal `light.*`/`switch.*` entity).

**Second design question raised, and resolved — staying in sync between
transitions:** our restart-safety proof only covers two moments: the
schedule's on/off state *changing*, and Home Assistant *starting up*.
Between those moments — someone manually flips an entity, another
automation touches it, a device glitches — nothing corrects it; the
current design is edge-triggered, not continuously enforcing. Whether
that's acceptable depends on the entity: for lights, letting a manual
override persist until the next scheduled transition is often the
*desired* behavior (an automation that instantly fights a manual toggle is
annoying); for an irrigation valve, drift being silently uncorrected for
hours is a real safety concern.

**Confirmed by the user 2026-09-11**, with the concrete case that makes
this non-negotiable: "turn the light on at this time" is fine, but if
someone is in that room and turned the light *off* on purpose, forcing it
back on because the schedule says "active" would be genuinely bad
behavior. Their framing: maximum flexibility is worth it as long as it's
covered by configuration (a real setting, not a hidden default) and
doesn't introduce failure modes of its own — i.e., the default must be the
*safe, unsurprising* one (transition-only, no fighting overrides), with
strictness as something explicitly opted into per schedule, not assumed.

Resolution: add an optional **periodic recheck** to the blueprint — a
`time_pattern` trigger (e.g. every N minutes) that re-asserts "what should
this be right now" on a cadence, in addition to the existing
transition/startup triggers. This is a normal, idiomatic HA pattern (not a
hack, not "an automation that fires perpetually" in any unusual sense —
`time_pattern` is a first-class trigger type built for exactly this), and
it stays inside the automation engine rather than requiring the
bigger custom-integration fork. Make the interval **configurable per
schedule** (including "off," today's transition-only behavior, as the
default) so tight enforcement can be chosen for a valve and looser
behavior kept for lights — one setting does not fit every entity.

A truly continuous, always-enforcing control loop *outside* the automation
engine entirely remains the same bigger fork already noted below (a real
Python backend with its own reconciliation logic) — the periodic trigger
gets most of the practical benefit without that jump in scope, and is the
right default answer unless real use proves it insufficient.

**Architecture tradeoff, unchanged:** this still goes through the
blueprint → `automation.*` entity mechanism (see the "Why this exists"
section above for the full reasoning on why that's unavoidable within HA's
execution model short of a from-scratch custom integration). The card
manages that automation's entire lifecycle via the config API — the user
never hand-edits YAML or opens Settings → Automations for this — but a
real automation entity will exist and be visible there if they go looking.

**Concrete tasks:**
- [x] Extend `local/schedule_sync.yaml` blueprint: `target_entity` (single)
      → `target_entities` (list, entity selector, domain: switch/light,
      `multiple: true`). Same on-while-active/off-otherwise polarity as
      before, applied to each entity in the list. **Verified live** on the
      real HA instance: a throwaway multi-target test automation (two
      `input_boolean` dummies as stand-ins, not real devices) correctly
      turned both off from a single trigger.
- [x] Added the optional periodic-recheck: a single always-present
      `time_pattern` trigger firing every minute (`id: heartbeat`), gated
      by a per-schedule `recheck_interval_minutes` input (0/default =
      disabled) via `now().minute % interval == 0` — one static trigger
      covers any interval rather than needing per-interval trigger
      definitions. **Verified with a real controlled experiment**, not
      simulated: forced two dummy entities into a mismatched state, one
      bound to a recheck=0 automation and one to recheck=1; after ~2.5
      real minutes elapsed (no manual trigger calls), the recheck=0 one
      was still wrong (correctly untouched — proves "off" really means
      off, not "just short of firing yet") and the recheck=1 one had been
      corrected back to the right state by the real heartbeat trigger
      firing naturally.
- Gotcha hit again during this work: editing a blueprint file on disk and
  calling `automation.reload` immediately can still validate/run against
  the *old* schema for one call (`Missing input target_entity` even though
  `target_entities` was confirmed on disk) — a second `reload` a few
  seconds later picked up the change fine. Build in a retry/longer-wait
  expectation for any future scripted blueprint edit+reload, same as the
  first time this was hit earlier in the project.
- [x] Linking convention: deterministic automation id `schedule_sync_<schedule_id>`
      (`automation-api.ts`), looked up directly via `GET
      config/automation/config/{id}` rather than searched for — a 404 means
      "no binding yet," any other error is surfaced.
- [x] Card UI: **resolved the open risk about `<ha-entity-picker>` empirically
      before building anything** — probed the live dev instance and confirmed
      both `ha-selector` and `ha-entity-picker` are globally registered
      custom elements, usable from any shadow DOM including a custom card's.
      Went with `<ha-selector>` (`.selector = {entity: {domain: [switch,
      light], multiple: true}}`) since it's the exact same component/schema
      HA's own blueprint-input forms render, not a different one. A new
      "controls" icon (plug) in each schedule's header toggles a panel with
      the selector plus a recheck-interval number input; the panel is
      collapsed by default (consistent with UI feedback round 1 — this
      does not reintroduce the "too long" problem).
- [x] Combined delete flow: `handleDelete` now calls `deleteBinding()` before
      `deleteSchedule()` — verified live with a disposable throwaway
      schedule (bound to `switch.decorative_lights` via the actual UI, then
      deleted via the actual delete button): schedule, automation config,
      and automation entity all confirmed gone (404) afterward.
- **Not done, deliberately deferred**: a combined *create* flow (prompting
  for entities right when a new schedule is made). The "controls" panel is
  reachable immediately after creation the same way as for any existing
  schedule, so this is a minor convenience, not a functional gap — not
  worth the extra flow complexity unless it turns out to matter in practice.
- [x] Updated `README.md` (now "Controlling entities from a schedule") to
      describe the card-managed flow instead of a separately-set-up
      pattern, and added the blueprint itself to the repo at
      `local/schedule_sync.yaml` (previously it only ever existed on the
      real/dev HA instances directly, never committed here) so a fresh
      install actually has something to copy in.
- [ ] Nice-to-have, not done: a one-click My Home Assistant blueprint
      import link/badge for `local/schedule_sync.yaml`, so installing it
      doesn't require manually copying a file into
      `config/blueprints/automation/local/`.

**Verified fully end-to-end against the dev instance**, real click path
throughout (not just API calls): added HA's built-in `demo:` platform to
the dev instance's `configuration.yaml` (restarted the *disposable*
container — fine, it's throwaway, not production) to get real `light`/
`switch` entities to bind to, since a bare instance has none. Then:
clicked the new controls icon on "New Sod Watering" → the real
`ha-selector` rendered → drove its `value-changed` event with
`light.bed_light` → confirmed via `GET config/automation/config/...` that
`automation.schedule_sync_new_sod_watering_...` was created with the
correct blueprint input → forced the light to the wrong state → fired the
automation → **the real light entity flipped to match the schedule**. Full
chain, card click to physical-equivalent device control, proven.

Two new discoveries worth keeping:
- `hass.callApi(method, path, data)` and `hass.callService(domain,
  service, data)` are both available on the `hass` object every custom
  card receives — no separate auth/connection plumbing needed for REST-
  style config endpoints (automation CRUD) alongside the websocket calls
  already used for `schedule/*`.
- `hass.callApi` rejects with `{error, status_code, body: {message}}` — a
  third error shape (after the two `errorMessage()` already handled),
  now also covered by that same shared helper and unit-tested.

### Milestone 5 — Timeline card, per-schedule icon/color (done, 2026-09-14)

Two user requests handled together since they share the same color-storage
question: a second, read-only card giving an at-a-glance multi-schedule
view, plus the ability to customize a schedule's icon and pick a color for
it (used by both cards).

**A real bug found and fixed along the way** — reported by the user
directly: the "controls" plug icon only showed its bound/highlighted state
*after* you'd opened that specific schedule's panel at least once that
session, because `getBinding()` was only ever called lazily on
panel-open. On a fresh page load, nothing had been fetched yet, so a
schedule with real entities bound looked identical to one with none —
looked like "the binding gets forgotten on refresh," but was really just
"never fetched yet." Fixed by fetching every schedule's binding up front
in `refresh()` (`loadAllBindings()`, parallel `Promise.allSettled`) instead
of waiting for the panel to open; the lazy fetch stays as a fallback for
schedules created after the initial load.

**Timezone gotcha, found from a real user report, not proactively caught:**
the user set a block intending "10:45 PM" their own time and it stayed
"Idle" when they expected it active. Root cause: this dev instance's HA
core timezone had never been explicitly set during scripted onboarding, so
it silently defaulted to UTC — and schedule blocks are evaluated purely
against whatever timezone HA core is configured for, not the browser's
timezone (unlike some other entities that do client-side tz-aware
rendering). Fixed by setting the dev instance to `America/Chicago` via the
`config/core/update` websocket command, matching the real production
instance — chosen deliberately over matching the user's momentary physical
location, since the dev sandbox exists to test what will actually run on
the CDT-based real home, not wherever the tester happens to be sitting.
**Lesson for any future scripted HA onboarding**: explicitly set
`time_zone` (and probably `latitude`/`longitude`/`unit_system`) rather than
leaving `core_config` onboarding a no-op default — UTC-by-accident is a
real, confusing failure mode, not a hypothetical one.

**Color storage:** probed `frontend/get_user_data` / `frontend/set_user_data`
before building against them (same discipline as every other new API
surface this project has touched) — confirmed both work and are the exact
mechanism HA's own frontend uses for per-user settings, so colors persist
per HA account rather than per-browser the way `localStorage` would.
Single key `schedule_editor_card_colors` holding `{scheduleId: hexColor}`,
shared between both cards via `user-data-api.ts`.

**Icon editing:** same pattern as the entity-binding picker — confirmed
`ha-selector`/`ha-icon-picker` are globally registered before building
(they were, already known from Milestone 4's probe) — click a schedule's
icon to open `<ha-selector selector="{icon: {}}">` inline, saves via the
existing `updateSchedule()` call. Verified live: changed "Empty Schedule"'s
icon to `mdi:leaf` through the real picker, confirmed it persisted and
re-rendered.

**Timeline card (`schedule-timeline-card`):** one track per schedule,
today's blocks only, icon per track (click, or hover on desktop, to show
the schedule's name — implemented as a native `title` attribute for free
desktop hover plus a click-toggled popover so mobile taps get the same
result), a single shared "now" line positioned across every track at once
(not repeated per row — a genuinely different, better design than the
editor card's per-weekday-row now-line, since this view's whole point is
comparing multiple schedules against one shared clock), and per-block
"active right now" highlighting computed independently per block from
its own start/end vs. current time (not from the schedule entity's `state`
attribute) so it can never visually disagree with where the now-line
itself is drawn. Deliberately read-only — no CRUD duplicated from the
editor card, keeping each card single-purpose.

**Packaging decision:** both cards ship in the *same* bundle
(`dist/schedule-editor-card.js`) via a new `src/index.ts` entry that
imports both card modules — chosen specifically to avoid touching HACS
packaging (`hacs.json`'s `filename`, the release workflow, the Lovelace
resource the user already has registered) for what is, from HACS's point
of view, still one plugin resource. Each card still self-registers its own
`window.customCards` entry so both show up individually in the dashboard's
"add card" picker.

**All verified live against the dev instance**, real click paths, not just
API calls: confirmed the binding-highlight bug reproduced *before* the fix
(fresh load, no panel opened, icon shows unbound) and resolved *after*
(fresh load, icon correctly shows bound with zero interaction); confirmed
the timezone fix by checking `testify!`'s computed state against real wall
-clock CDT time; changed a schedule's icon and multiple schedules' colors
through their actual pickers and confirmed persistence via the respective
list/get_user_data calls; loaded the timeline card fresh and confirmed
colors, icons, and the shared now-line render correctly; clicked a track's
icon and confirmed the name tooltip appears.

**Gotcha reconfirmed** (same as Milestone 4, worth noting it recurred): a
lovelace resource URL with no cache-busting query string can serve stale
JS after a rebuild even across a full browser refresh — this is what the
user actually hit first when the icon/binding features "didn't show up."
Fixed by bumping `?v=<timestamp>` on the resource URL after every rebuild
during this dev cycle; production installs won't hit this the same way
since HACS-driven installs typically get a fresh resource version per
release rather than silently overwriting the same file path.

### Milestone 6 — Reproducible dense fixture set + first UI-scale test (done, 2026-09-14)

User feedback: fixture data had been created one-off via ad-hoc scratch
scripts each session (never checked in beyond the original 4 basic
fixtures), and they wanted to actually see how the UI holds up with real
volume — "I want 2 schedules going at all times. I want at least 15
schedule entities total."

**`dev/seed-schedules.mjs` is now the single source of truth for the dev
instance's fixture set**, checked into the repo, not scratch. Idempotent
by design: looks up each fixture by name first and skips ones that already
exist, so re-running it (e.g. after `docker compose down -v && up -d` for
a clean slate, or just on top of a running instance) is always safe and
never creates duplicates.

**"2 schedules active at all times," proven, not eyeballed:** built as two
independent `buildCoverageLayer()` generators - Layer A, 6 schedules x 4h
("Security Lighting"), Layer B, 8 schedules x 3h ("Perimeter Sensors
Armed") - each tiling the full 24h, every day, with zero gaps on its own.
Any one full-coverage layer alone guarantees exactly one of its schedules
is active at every instant; two independent such layers therefore
guarantee at least 2 active at once, regardless of how their slot
boundaries line up. Plus 5 curated, varied fixtures (empty, sparse,
multi-block-per-day, weekend-only) for realistic diversity on top of the
dense layers - 19 fixtures total (6+8+5), comfortably over the "at least
15" ask, plus the user's own manually-created "testify!" = 20 real
schedule entities on the instance.

**A real bug in the seed script itself, caught by running it, not by
inspection:** the coverage-layer generator's last slot in each layer
computed `to: "00:00:00"` for "until midnight," which the native schedule
domain rejects (`to` must be after `from` on the same day) - it has no
native way to express "until midnight," same constraint the
hand-written "Near Midnight Block" fixture had already worked around.
Fixed by special-casing the final slot to `to: "23:59:59"` instead,
matching that existing pattern.

**The coverage guarantee itself was then verified exhaustively, not just
trusted from the math** - and this verification caught a second, purely
self-inflicted bug: a first check script sampled at 1-minute resolution
using a `toMin()` helper that silently dropped the seconds component of
`"23:59:59"` (truncating it to effectively `"23:59:00"`), which made the
last minute of each day look uncovered. Re-verified at 5-second resolution
with proper seconds handling: **minimum simultaneous-active count across
the full day is exactly 2, with zero exceptions** (sampled 17,280 points
across 86,400 seconds). The lesson generalizes: a verification script is
also code and can have its own bugs - a suspicious result should prompt
checking the checker before concluding the thing being checked is wrong.

**UI-scale findings, from actually looking at 20 schedules rendered, not
guessing:**
- `schedule-timeline-card` **scales well** - one compact row per schedule
  regardless of how many blocks it has; 20 tracks fit in a reasonable
  height with no structural problem.
- `schedule-editor-card` **does not scale well** - a schedule active every
  day with an identical block (e.g. "Security Lighting 00:00-04:00")
  currently renders that same block as 7 separate, visually-identical
  chips, one per weekday. At 20 schedules this makes for a very long, very
  repetitive page. **Not fixed yet** - flagged as a concrete finding for
  the user's reaction rather than redesigned unilaterally, consistent with
  how UI-opinion-dependent work has been handled throughout this project.
  Likely fix direction if/when picked up: detect "same block appears on
  every day" and collapse it to a single "Daily" chip instead of 7
  identical ones - not attempted yet, pending the user's read on it.

### Milestone 7 — Timeline labels + the "time is the unit, days are a property" editor rework (done, 2026-09-14)

Direct response to the scaling finding above, plus timeline usability
feedback, both from the same review session.

**Editor rework - the actual fix for Milestone 6's finding:** the user
proposed inverting the model: instead of "day is unique, times repeat"
(a block belongs to one day's array; the same time on 7 days is 7 separate
things to look at), treat the *time range* as the unit and days as a
property of it - "08:00-08:20, M/T/W/Th/F/Sa/Su" as one entry, not seven.

This is a display/editing reinterpretation only - **the native storage
format did not change** (still per-day arrays, `schedule/update` still
takes all seven). What changed is `groupedBlocks()` (`schedule-api.ts`,
unit-tested standalone before touching any UI): it regroups a schedule's
per-day arrays by exact `{from, to}` identity into `{from, to, days[]}`
entries. Two blocks merge into one group *only* on an exact match - a
block one minute off on one day is correctly kept as its own group, not
folded in as a rendering quirk.

The card now renders one row per group: click the time text to edit it
(applies to every day currently in that group, one combined write, not
one per day); click a day pill to add/remove that single day from the
group (touches only that one day's array); a matching "add new block"
form takes a time range plus day-pill checkboxes instead of a single day
dropdown, writing the new block to every checked day in one combined
update, rejecting the whole thing if *any* checked day would overlap
(all-or-nothing, not partial).

**Concrete effect, same fixture set used for Milestone 6's finding:**
"Security Lighting 00:00-04:00" (identical block on all 7 days) now
renders as **one chip**, not seven. "New Sod Watering" (2 distinct times
across 4 days each) is **2 chips**, not 8.

Verified live, both directions, not just the render: toggled a day pill
off on an existing group (removed Saturday from "Near Midnight Block"),
confirmed via `schedule/list` that only Saturday's array changed; added a
new group via the actual add-form with two days checked (Monday and
Wednesday), confirmed both days' arrays got the identical new block in a
single write.

**Timeline card labeling**, the other half of this round's feedback -
"is it a day view? it should indicate that," hour gridlines, a label for
what the now-line means:
- Header now shows a subtitle, "Today · `<Weekday>`" - answers "is this a
  day view" directly rather than leaving it implicit.
- An hour axis row (12am/3am/6am/.../9pm, every 3 hours) plus dotted
  gridlines at every hour, spanning down through every track.
- A small red time label ("4:35 PM") floating above the now-line itself.
- **Alignment implementation note:** the axis, the gridline/now-line
  overlay, and every track's bars all had to land in the exact same
  horizontal pixel range. Approximating this with matching padding on
  separate flex rows (the original approach that would have been used)
  is fragile - instead the whole chart is one CSS Grid
  (`grid-template-columns: 32px 1fr`), and the overlay is a single
  absolutely-positioned grid item placed with `grid-column: 2; grid-row:
  1 / -1`, spanning that same bar-column across every row including the
  axis. This is exact by construction rather than approximated, and is a
  legitimately different (better) approach than the per-track now-line
  the editor card still uses for its own (single-schedule, no shared axis
  needed) weekly view - not a candidate to backport there, different
  problem shape.
- **A real bug caught by checking computed styles, not just eyeballing a
  screenshot:** the first attempt colored gridlines with `--divider-color`
  - the exact same token the track bars themselves use as their
  background - making them invisible on top of any bar. A screenshot at
  normal compression didn't make this obvious either way, so this was
  confirmed by reading the actual computed `border-left`/`opacity` in the
  browser rather than trusting how a screenshot looked. Fixed with
  `--secondary-text-color` at reduced opacity (0.6, bumped once from an
  initial 0.4 for safety margin), which contrasts against both the bars
  and the gaps between them.

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
