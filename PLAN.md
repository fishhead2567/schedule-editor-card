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
- Milestone 4 (entity selection — on/off entity lists per schedule) not
  started; design finalized 2026-09-11, see that section.

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
- [ ] Visual config editor (`getConfigElement`) so the card can be added
      through the dashboard UI picker without hand-written YAML.
- [ ] Edit-in-place for existing blocks.
- [ ] Basic accessibility pass.
- [ ] Consider drag-to-create/resize on the timeline bars (nice-to-have,
      not required — click + time-inputs already works).

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
- [ ] Extend `local/schedule_sync.yaml` blueprint: `target_entity` (single)
      → `target_entities` (list, entity selector, domain: switch/light,
      `multiple: true`). Same on-while-active/off-otherwise polarity as
      today, just applied to each entity in the list.
- [ ] Add the optional periodic-recheck `time_pattern` trigger, interval as
      a blueprint input (minutes; a sentinel like 0 or omitted = disabled).
      Re-verify restart-safety AND the new recheck behavior empirically
      (force a mismatched state mid-window with recheck enabled, confirm
      it self-corrects within roughly the configured interval) — don't
      assume it works from the trigger existing; prove it the same way the
      original restart-safety claim was proven.
- [ ] Linking convention between a `schedule.*` entity and its bound
      automation — simplest option: deterministic automation id derived
      from the schedule id (e.g. `schedule_sync_<schedule_id>`), looked up
      directly rather than searched for.
- [ ] Card UI: per-schedule, a multi-select entity picker (include groups)
      plus the recheck-interval control. Likely reuse HA's own
      `<ha-entity-picker>` element rather than hand-rolling one — check
      whether that element is safely usable from a custom card's shadow
      DOM before committing to it.
- [ ] Combined create flow: creating a new schedule from the card should
      offer to set up its automation binding (entities + recheck interval)
      in the same step, not as a separate manual task.
- [ ] Combined delete flow: deleting a schedule should prompt to also
      delete its bound automation (an orphaned automation pointing at a
      deleted schedule entity would silently do nothing, which is a worse
      failure mode than asking).
- [ ] Update `README.md`'s "Pairing with an automation" section — it
      currently documents this as something the user sets up separately;
      once Milestone 4 lands, the card does it, so the docs need to change
      from "here's the pattern" to "the card does this for you."

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
