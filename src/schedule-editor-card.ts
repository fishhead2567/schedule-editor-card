import { LitElement, html, css, TemplateResult, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { AutomationBinding, CardConfig, GroupedBlock, HomeAssistant, ScheduleDays, ScheduleRecord, WEEKDAYS, Weekday } from "./types";
import { createSchedule, daysOf, deleteSchedule, errorMessage, groupedBlocks, listSchedules, scheduleEntitiesFingerprint, updateSchedule, emptyDays } from "./schedule-api";
import { deleteBinding, getBinding, saveBinding } from "./automation-api";
import { DEFAULT_COLOR, getColors, setColor } from "./user-data-api";
import { currentMinutesInZone, hasOverlap, percentOfDay, todayWeekdayInZone, toMinutes } from "./time-utils";

const DAY_LABEL: Record<Weekday, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

const DAY_PILL_LABEL: Record<Weekday, string> = {
  monday: "Mo",
  tuesday: "Tu",
  wednesday: "We",
  thursday: "Th",
  friday: "Fr",
  saturday: "Sa",
  sunday: "Su",
};

interface NewGroupDraft {
  from: string;
  to: string;
  days: Set<Weekday>;
}

function blockKey(from: string, to: string): string {
  return `${from}|${to}`;
}

@customElement("schedule-editor-card")
export class ScheduleEditorCard extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @state() private config!: CardConfig;
  @state() private schedules: ScheduleRecord[] = [];
  @state() private loading = true;
  @state() private error: string | null = null;
  @state() private expandedTimelines: Set<string> = new Set();
  @state() private editingGroup: { scheduleId: string; key: string } | null = null;
  @state() private editBlockDraft: { from: string; to: string } = { from: "00:00", to: "00:30" };
  @state() private newGroupDrafts: Record<string, NewGroupDraft> = {};
  @state() private expandedBindings: Set<string> = new Set();
  // undefined = not fetched yet, null = fetched, no binding exists.
  @state() private bindings: Record<string, AutomationBinding | null | undefined> = {};
  @state() private editingIconFor: string | null = null;
  @state() private colors: Record<string, string> = {};

  private nowTimer?: number;
  // Placeholder until connectedCallback can consult hass.config.time_zone;
  // todayWeekdayInZone/currentMinutesInZone fall back to the browser's own
  // zone if hass isn't ready yet, so this is never actually wrong, just
  // momentarily using the fallback rather than the server's real zone.
  private todayWeekday: Weekday = "monday";
  // See scheduleEntitiesFingerprint / updated() below - lets an external
  // change (another tab, the Helpers UI, a second card instance) show up
  // here without a manual page refresh.
  private lastScheduleFingerprint = "";

  setConfig(config: CardConfig): void {
    this.config = { type: config.type, title: config.title, entities: config.entities };
  }

  getCardSize(): number {
    return 2 + this.schedules.length * 2;
  }

  static getConfigElement(): HTMLElement {
    return document.createElement("schedule-editor-card-editor");
  }

  static getStubConfig(): CardConfig {
    return { type: "custom:schedule-editor-card" };
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.refresh();
    this.todayWeekday = todayWeekdayInZone(this.hass?.config?.time_zone);
    getColors(this.hass)
      .then((colors) => (this.colors = colors))
      .catch((e) => (this.error = errorMessage(e)));
    // Re-render the "now" line every minute; no need to re-fetch schedules for this.
    this.nowTimer = window.setInterval(() => {
      this.todayWeekday = todayWeekdayInZone(this.hass?.config?.time_zone);
      this.requestUpdate();
    }, 60_000);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.nowTimer) window.clearInterval(this.nowTimer);
  }

  protected updated(changedProperties: Map<string, unknown>): void {
    super.updated(changedProperties);
    if (changedProperties.has("hass") && this.hass) {
      const fingerprint = scheduleEntitiesFingerprint(this.hass);
      if (fingerprint !== this.lastScheduleFingerprint) {
        this.lastScheduleFingerprint = fingerprint;
        this.refresh();
      }
    }
  }

  private async refresh(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const all = await listSchedules(this.hass);
      const wanted = this.config.entities;
      this.schedules = wanted
        ? all.filter((s) => wanted.includes(`schedule.${s.id}`))
        : all;
    } catch (e) {
      this.error = errorMessage(e);
    } finally {
      this.loading = false;
    }
    this.loadAllBindings();
  }

  /**
   * The "controls" plug icon needs to show as bound (or not) for every
   * schedule as soon as the card loads, not just for whichever one you
   * happen to open - fetch all of them up front rather than lazily on
   * panel-open (a real bug: without this, the highlight only ever appeared
   * after clicking into a schedule's panel at least once that session, so
   * it looked like the binding itself was forgotten on every refresh).
   */
  private async loadAllBindings(): Promise<void> {
    const results = await Promise.allSettled(
      this.schedules.map(async (s) => [s.id, await getBinding(this.hass, s.id)] as const)
    );
    const next = { ...this.bindings };
    for (const r of results) {
      if (r.status === "fulfilled") {
        const [id, binding] = r.value;
        next[id] = binding;
      }
    }
    this.bindings = next;
  }

  private entityIdFor(scheduleId: string): string {
    return `schedule.${scheduleId}`;
  }

  private stateOf(scheduleId: string): string | undefined {
    return this.hass?.states?.[this.entityIdFor(scheduleId)]?.state;
  }

  private draftFor(scheduleId: string): NewGroupDraft {
    return this.newGroupDrafts[scheduleId] ?? { from: "00:00", to: "00:30", days: new Set() };
  }

  private updateDraftTime(scheduleId: string, patch: Partial<Pick<NewGroupDraft, "from" | "to">>): void {
    this.newGroupDrafts = {
      ...this.newGroupDrafts,
      [scheduleId]: { ...this.draftFor(scheduleId), ...patch },
    };
  }

  private toggleDraftDay(scheduleId: string, day: Weekday): void {
    const current = this.draftFor(scheduleId);
    const nextDays = new Set(current.days);
    if (nextDays.has(day)) nextDays.delete(day);
    else nextDays.add(day);
    this.newGroupDrafts = { ...this.newGroupDrafts, [scheduleId]: { ...current, days: nextDays } };
  }

  private toggleTimeline(scheduleId: string): void {
    const next = new Set(this.expandedTimelines);
    if (next.has(scheduleId)) next.delete(scheduleId);
    else next.add(scheduleId);
    this.expandedTimelines = next;
  }

  private colorOf(scheduleId: string): string {
    return this.colors[scheduleId] ?? DEFAULT_COLOR;
  }

  private async handleColorChange(scheduleId: string, color: string): Promise<void> {
    const previous = this.colors;
    this.colors = { ...this.colors, [scheduleId]: color };
    try {
      await setColor(this.hass, scheduleId, color);
    } catch (e) {
      this.error = errorMessage(e);
      this.colors = previous;
    }
  }

  private toggleIconEditor(scheduleId: string): void {
    this.editingIconFor = this.editingIconFor === scheduleId ? null : scheduleId;
  }

  private async handleIconChange(record: ScheduleRecord, icon: string): Promise<void> {
    this.editingIconFor = null;
    try {
      const updated = await updateSchedule(this.hass, record.id, record.name, icon, daysOf(record));
      this.schedules = this.schedules.map((s) => (s.id === record.id ? updated : s));
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  private async toggleBindingPanel(scheduleId: string): Promise<void> {
    const next = new Set(this.expandedBindings);
    if (next.has(scheduleId)) {
      next.delete(scheduleId);
      this.expandedBindings = next;
      return;
    }
    next.add(scheduleId);
    this.expandedBindings = next;
    if (this.bindings[scheduleId] === undefined) {
      try {
        const binding = await getBinding(this.hass, scheduleId);
        this.bindings = { ...this.bindings, [scheduleId]: binding };
      } catch (e) {
        this.error = errorMessage(e);
      }
    }
  }

  private async handleBindingChange(record: ScheduleRecord, patch: Partial<AutomationBinding>): Promise<void> {
    const current = this.bindings[record.id] ?? { entities: [], recheckMinutes: 0 };
    const next: AutomationBinding = { ...current, ...patch };
    // Optimistic update so the picker doesn't visually snap back while the
    // save is in flight.
    this.bindings = { ...this.bindings, [record.id]: next };
    try {
      await saveBinding(this.hass, record.id, record.name, next);
    } catch (e) {
      this.error = errorMessage(e);
      // Revert on failure rather than leave the UI claiming a save that didn't happen.
      this.bindings = { ...this.bindings, [record.id]: current };
    }
  }

  private async handleAddSchedule(): Promise<void> {
    const name = window.prompt("Name for the new schedule?");
    if (!name) return;
    try {
      const created = await createSchedule(this.hass, name, "mdi:calendar-clock", emptyDays());
      this.schedules = [...this.schedules, created];
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  private async handleDuplicate(record: ScheduleRecord): Promise<void> {
    const name = window.prompt("Name for the duplicate?", `${record.name} copy`);
    if (!name) return;
    try {
      const created = await createSchedule(this.hass, name, record.icon, daysOf(record));
      this.schedules = [...this.schedules, created];
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  private async handleDelete(record: ScheduleRecord): Promise<void> {
    if (!window.confirm(`Delete "${record.name}"? This cannot be undone.`)) return;
    try {
      // Delete the bound automation first (if any) - an orphaned automation
      // pointing at a since-deleted schedule entity would silently do
      // nothing, which is a worse failure mode than a slightly slower delete.
      await deleteBinding(this.hass, record.id);
      await deleteSchedule(this.hass, record.id);
      this.schedules = this.schedules.filter((s) => s.id !== record.id);
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  private async persistAllDays(record: ScheduleRecord, days: ScheduleDays): Promise<void> {
    try {
      const updated = await updateSchedule(this.hass, record.id, record.name, record.icon, days);
      this.schedules = this.schedules.map((s) => (s.id === record.id ? updated : s));
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  private handleStartEditGroup(record: ScheduleRecord, group: GroupedBlock): void {
    this.editingGroup = { scheduleId: record.id, key: blockKey(group.from, group.to) };
    this.editBlockDraft = { from: group.from.slice(0, 5), to: group.to.slice(0, 5) };
  }

  private handleCancelEditGroup(): void {
    this.editingGroup = null;
  }

  /** Editing a group's time changes it for every day currently in that
   * group, in one combined write - not one write per day. */
  private async handleSaveEditGroup(record: ScheduleRecord, group: GroupedBlock): Promise<void> {
    const from = `${this.editBlockDraft.from}:00`;
    const to = `${this.editBlockDraft.to}:00`;
    if (toMinutes(from) >= toMinutes(to)) {
      this.error = "Start time must be before end time.";
      return;
    }
    const newDays = daysOf(record);
    for (const day of group.days) {
      const withoutOld = newDays[day].filter((b) => blockKey(b.from, b.to) !== blockKey(group.from, group.to));
      const candidate = [...withoutOld, { from, to }];
      if (hasOverlap(candidate)) {
        this.error = `That time overlaps an existing block on ${DAY_LABEL[day]}.`;
        return;
      }
      newDays[day] = candidate;
    }
    this.error = null;
    this.editingGroup = null;
    await this.persistAllDays(record, newDays);
  }

  private async handleDeleteGroup(record: ScheduleRecord, group: GroupedBlock): Promise<void> {
    const newDays = daysOf(record);
    for (const day of group.days) {
      newDays[day] = newDays[day].filter((b) => blockKey(b.from, b.to) !== blockKey(group.from, group.to));
    }
    await this.persistAllDays(record, newDays);
  }

  /** Toggling a day pill only ever touches that one day's array. */
  private async handleToggleGroupDay(record: ScheduleRecord, group: GroupedBlock, day: Weekday): Promise<void> {
    const days = daysOf(record);
    const alreadyIncluded = group.days.includes(day);
    let nextForDay;
    if (alreadyIncluded) {
      nextForDay = days[day].filter((b) => blockKey(b.from, b.to) !== blockKey(group.from, group.to));
    } else {
      nextForDay = [...days[day], { from: group.from, to: group.to }];
      if (hasOverlap(nextForDay)) {
        this.error = `That time overlaps an existing block on ${DAY_LABEL[day]}.`;
        return;
      }
    }
    this.error = null;
    const newDays = { ...days, [day]: nextForDay };
    await this.persistAllDays(record, newDays);
  }

  private async handleAddGroup(record: ScheduleRecord): Promise<void> {
    const draft = this.draftFor(record.id);
    const from = `${draft.from}:00`;
    const to = `${draft.to}:00`;
    if (toMinutes(from) >= toMinutes(to)) {
      this.error = "Start time must be before end time.";
      return;
    }
    if (draft.days.size === 0) {
      this.error = "Pick at least one day.";
      return;
    }
    const newDays = daysOf(record);
    for (const day of draft.days) {
      const candidate = [...newDays[day], { from, to }];
      if (hasOverlap(candidate)) {
        this.error = `That time overlaps an existing block on ${DAY_LABEL[day]}.`;
        return;
      }
      newDays[day] = candidate;
    }
    this.error = null;
    this.newGroupDrafts = { ...this.newGroupDrafts, [record.id]: { from: "00:00", to: "00:30", days: new Set() } };
    await this.persistAllDays(record, newDays);
  }

  render(): TemplateResult {
    if (this.loading) {
      return html`<ha-card><div class="pad">Loading schedules…</div></ha-card>`;
    }
    return html`
      <ha-card>
        <div class="header">
          <div class="title">${this.config.title ?? "Schedules"}</div>
          <mwc-button @click=${this.handleAddSchedule}>+ New schedule</mwc-button>
        </div>
        ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
        ${this.schedules.length === 0
          ? html`<div class="pad">No schedules yet.</div>`
          : this.schedules.map((record) => this.renderSchedule(record))}
      </ha-card>
    `;
  }

  private renderSchedule(record: ScheduleRecord): TemplateResult {
    const isOn = this.stateOf(record.id) === "on";
    const expanded = this.expandedTimelines.has(record.id);
    const bindingsOpen = this.expandedBindings.has(record.id);
    const groups = groupedBlocks(record);
    const binding = this.bindings[record.id];
    const boundCount = binding?.entities.length ?? 0;
    return html`
      <div class="schedule">
        <div class="schedule-header">
          <ha-icon-button
            .label=${expanded ? "Hide weekly view" : "Show weekly view"}
            @click=${() => this.toggleTimeline(record.id)}
          >
            <ha-icon icon=${expanded ? "mdi:chevron-down" : "mdi:chevron-right"}></ha-icon>
          </ha-icon-button>
          <button
            class="icon-button"
            aria-label="Change icon"
            title="Change icon"
            @click=${() => this.toggleIconEditor(record.id)}
          >
            <ha-icon icon=${record.icon || "mdi:calendar-clock"}></ha-icon>
          </button>
          <span class="name">${record.name}</span>
          <span class="pill ${isOn ? "on" : "off"}">${isOn ? "Active now" : "Idle"}</span>
          <span class="spacer"></span>
          <label class="color-swatch" title="Change color" style="background:${this.colorOf(record.id)}">
            <input
              type="color"
              aria-label="Change color"
              .value=${this.colorOf(record.id)}
              @input=${(e: Event) => this.handleColorChange(record.id, (e.target as HTMLInputElement).value)}
            />
          </label>
          <ha-icon-button
            .label=${boundCount > 0 ? `Controls ${boundCount} ${boundCount === 1 ? "entity" : "entities"}` : "Controls: none set"}
            class=${boundCount > 0 ? "has-binding" : ""}
            @click=${() => this.toggleBindingPanel(record.id)}
          >
            <ha-icon icon="mdi:power-plug-outline"></ha-icon>
          </ha-icon-button>
          <ha-icon-button @click=${() => this.handleDuplicate(record)} label="Duplicate">
            <ha-icon icon="mdi:content-copy"></ha-icon>
          </ha-icon-button>
          <ha-icon-button @click=${() => this.handleDelete(record)} label="Delete">
            <ha-icon icon="mdi:delete"></ha-icon>
          </ha-icon-button>
        </div>

        ${this.editingIconFor === record.id ? this.renderIconEditor(record) : nothing}
        ${bindingsOpen ? this.renderBindingPanel(record) : nothing}

        <div class="block-list">
          ${groups.length === 0
            ? html`<div class="muted">No blocks yet.</div>`
            : groups.map((g) => this.renderGroupChip(record, g))}
          ${this.renderAddGroupForm(record)}
        </div>

        ${expanded
          ? html`<div class="days">${WEEKDAYS.map((day) => this.renderDayRow(record, day))}</div>`
          : nothing}
      </div>
    `;
  }

  private renderIconEditor(record: ScheduleRecord): TemplateResult {
    return html`
      <div class="icon-editor">
        <ha-selector
          .hass=${this.hass}
          .selector=${{ icon: {} }}
          .value=${record.icon ?? ""}
          @value-changed=${(e: CustomEvent<{ value: string }>) => this.handleIconChange(record, e.detail.value)}
        ></ha-selector>
      </div>
    `;
  }

  private renderBindingPanel(record: ScheduleRecord): TemplateResult {
    const binding = this.bindings[record.id];
    if (binding === undefined) {
      return html`<div class="binding-panel muted">Loading controls…</div>`;
    }
    const entities = binding?.entities ?? [];
    const recheck = binding?.recheckMinutes ?? 0;
    return html`
      <div class="binding-panel">
        <div class="binding-row">
          <span class="binding-label">Controls</span>
          <ha-selector
            .hass=${this.hass}
            .selector=${{ entity: { domain: ["switch", "light"], multiple: true } }}
            .value=${entities}
            @value-changed=${(e: CustomEvent<{ value: string[] }>) =>
              this.handleBindingChange(record, { entities: e.detail.value })}
          ></ha-selector>
        </div>
        <div class="binding-row">
          <span class="binding-label">Recheck every</span>
          <input
            type="number"
            aria-label="Recheck interval in minutes, 0 for only at transitions and startup"
            min="0"
            max="60"
            .value=${String(recheck)}
            @change=${(e: Event) =>
              this.handleBindingChange(record, { recheckMinutes: Number((e.target as HTMLInputElement).value) })}
          />
          <span class="muted">min (0 = only at transitions/startup)</span>
        </div>
      </div>
    `;
  }

  private renderDayPills(
    activeDays: Weekday[],
    onToggle: (day: Weekday) => void
  ): TemplateResult {
    return html`
      <div class="day-pills">
        ${WEEKDAYS.map(
          (d) => html`
            <button
              class="day-pill ${activeDays.includes(d) ? "on" : ""}"
              title=${DAY_LABEL[d]}
              aria-label=${DAY_LABEL[d]}
              aria-pressed=${activeDays.includes(d)}
              @click=${() => onToggle(d)}
            >
              ${DAY_PILL_LABEL[d]}
            </button>
          `
        )}
      </div>
    `;
  }

  private renderGroupChip(record: ScheduleRecord, group: GroupedBlock): TemplateResult {
    const isEditing =
      this.editingGroup?.scheduleId === record.id &&
      this.editingGroup?.key === blockKey(group.from, group.to);

    const pills = this.renderDayPills(group.days, (day) => this.handleToggleGroupDay(record, group, day));

    if (isEditing) {
      return html`
        <div class="block-chip editing">
          <input
            type="time"
            aria-label="Start time"
            .value=${this.editBlockDraft.from}
            @change=${(e: Event) =>
              (this.editBlockDraft = { ...this.editBlockDraft, from: (e.target as HTMLInputElement).value })}
          />
          <span>–</span>
          <input
            type="time"
            aria-label="End time"
            .value=${this.editBlockDraft.to}
            @change=${(e: Event) =>
              (this.editBlockDraft = { ...this.editBlockDraft, to: (e.target as HTMLInputElement).value })}
          />
          <button title="Save" aria-label="Save" @click=${() => this.handleSaveEditGroup(record, group)}>✓</button>
          <button title="Cancel" aria-label="Cancel" @click=${() => this.handleCancelEditGroup()}>×</button>
          ${pills}
        </div>
      `;
    }

    return html`
      <div class="block-chip">
        <button
          class="chip-text"
          title="Click to edit time"
          aria-label="Edit block ${group.from.slice(0, 5)} to ${group.to.slice(0, 5)}"
          @click=${() => this.handleStartEditGroup(record, group)}
        >
          ${group.from.slice(0, 5)}–${group.to.slice(0, 5)}
        </button>
        ${pills}
        <button
          title="Delete"
          aria-label="Delete block ${group.from.slice(0, 5)} to ${group.to.slice(0, 5)}"
          @click=${() => this.handleDeleteGroup(record, group)}
        >
          ×
        </button>
      </div>
    `;
  }

  private renderAddGroupForm(record: ScheduleRecord): TemplateResult {
    const draft = this.draftFor(record.id);
    return html`
      <div class="add-block">
        <input
          type="time"
          aria-label="New block start time"
          .value=${draft.from}
          @change=${(e: Event) => this.updateDraftTime(record.id, { from: (e.target as HTMLInputElement).value })}
        />
        <span>to</span>
        <input
          type="time"
          aria-label="New block end time"
          .value=${draft.to}
          @change=${(e: Event) => this.updateDraftTime(record.id, { to: (e.target as HTMLInputElement).value })}
        />
        ${this.renderDayPills([...draft.days], (day) => this.toggleDraftDay(record.id, day))}
        <mwc-button @click=${() => this.handleAddGroup(record)}>+ Add</mwc-button>
      </div>
    `;
  }

  private renderDayRow(record: ScheduleRecord, day: Weekday): TemplateResult {
    const blocks = daysOf(record)[day];
    const isToday = day === this.todayWeekday;
    const nowPct = (currentMinutesInZone(this.hass?.config?.time_zone) / 1440) * 100;

    return html`
      <div class="day-row">
        <div class="day-label">${DAY_LABEL[day]}</div>
        <div class="timeline">
          ${blocks.map(
            (b) => html`
              <div
                class="block"
                style="left:${percentOfDay(b.from)}%; width:${percentOfDay(b.to) - percentOfDay(b.from)}%"
                title="${b.from}–${b.to}"
              ></div>
            `
          )}
          ${isToday
            ? html`
                <div class="now-marker" style="left:${nowPct}%" title="Now" aria-hidden="true"></div>
                <div class="now-line" style="left:${nowPct}%" aria-hidden="true"></div>
              `
            : nothing}
        </div>
      </div>
    `;
  }

  static styles = css`
    .header {
      display: flex;
      align-items: center;
      padding: 12px 16px 4px;
    }
    .title {
      font-size: 1.2em;
      font-weight: 500;
      flex: 1;
    }
    .pad {
      padding: 16px;
    }
    .error {
      margin: 0 16px 8px;
      padding: 8px;
      background: var(--error-color, #db4437);
      color: white;
      border-radius: 4px;
      font-size: 0.9em;
    }
    .schedule {
      padding: 8px 16px 16px;
      border-top: 1px solid var(--divider-color);
    }
    .schedule-header {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 0 8px;
    }
    .name {
      font-weight: 500;
    }
    .pill {
      font-size: 0.75em;
      padding: 2px 8px;
      border-radius: 12px;
      background: var(--disabled-color, #bdbdbd);
      color: white;
    }
    .pill.on {
      background: var(--state-active-color, #2196f3);
    }
    .spacer {
      flex: 1;
    }
    .icon-button {
      border: none;
      background: none;
      cursor: pointer;
      padding: 8px;
      display: flex;
      align-items: center;
      color: inherit;
      border-radius: 50%;
    }
    .icon-button:hover {
      background: var(--secondary-background-color);
    }
    .icon-editor {
      padding: 4px 0 10px 40px;
      max-width: 320px;
    }
    .color-swatch {
      display: inline-flex;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 2px solid var(--divider-color);
      cursor: pointer;
      overflow: hidden;
      flex-shrink: 0;
      margin: 0 4px;
    }
    .color-swatch input[type="color"] {
      opacity: 0;
      width: 100%;
      height: 100%;
      cursor: pointer;
      border: none;
      padding: 0;
    }
    .has-binding {
      color: var(--state-active-color, #2196f3);
    }
    .binding-panel {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 4px 0 10px 40px;
    }
    .binding-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .binding-row ha-selector {
      flex: 1;
      max-width: 480px;
    }
    .binding-label {
      font-size: 0.8em;
      color: var(--secondary-text-color);
      width: 90px;
      flex-shrink: 0;
    }
    .binding-row input[type="number"] {
      width: 60px;
    }
    .block-list {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      padding-left: 40px;
    }
    .muted {
      color: var(--secondary-text-color);
      font-size: 0.85em;
    }
    .block-chip {
      display: flex;
      align-items: center;
      gap: 4px;
      background: var(--secondary-background-color);
      border-radius: 12px;
      padding: 2px 4px 2px 4px;
      font-size: 0.85em;
    }
    .chip-text {
      border: none;
      background: none;
      cursor: pointer;
      font: inherit;
      color: inherit;
      padding: 2px 4px;
    }
    .block-chip button {
      border: none;
      background: none;
      cursor: pointer;
      font-size: 1.1em;
      line-height: 1;
      color: var(--secondary-text-color);
    }
    .block-chip.editing {
      padding: 2px 6px;
      gap: 6px;
    }
    .block-chip.editing input[type="time"] {
      font-size: 0.85em;
    }
    .day-pills {
      display: flex;
      gap: 2px;
    }
    .day-pill {
      border: 1px solid var(--divider-color);
      background: none;
      color: var(--secondary-text-color);
      border-radius: 4px;
      width: 22px;
      height: 22px;
      font-size: 0.68em;
      line-height: 1;
      cursor: pointer;
      padding: 0;
    }
    .day-pill.on {
      background: var(--state-active-color, #2196f3);
      border-color: var(--state-active-color, #2196f3);
      color: white;
    }
    .add-block {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 0.85em;
    }
    .days {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding-left: 40px;
      margin-top: 10px;
    }
    .day-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 2px 0;
    }
    .day-label {
      width: 32px;
      font-size: 0.8em;
      color: var(--secondary-text-color);
    }
    .timeline {
      position: relative;
      flex: 1;
      height: 16px;
      background: var(--divider-color);
      border-radius: 3px;
      overflow: visible;
    }
    .block {
      position: absolute;
      top: 0;
      bottom: 0;
      background: var(--state-active-color, #2196f3);
      border-radius: 3px;
      overflow: hidden;
    }
    /*
     * The "now" indicator deliberately does NOT look like a block (which is
     * a filled rectangle in --state-active-color): it's a thin red line with
     * a small triangle flag, the same visual language as a video-editor
     * playhead / Google Calendar's current-time line, so it can't be
     * mistaken for scheduled content even on an empty day.
     */
    .now-line {
      position: absolute;
      top: -2px;
      bottom: -2px;
      width: 1.5px;
      background: var(--now-line-color, var(--error-color, #ff5252));
      pointer-events: none;
    }
    .now-marker {
      position: absolute;
      top: -7px;
      width: 0;
      height: 0;
      border-left: 4px solid transparent;
      border-right: 4px solid transparent;
      border-top: 5px solid var(--now-line-color, var(--error-color, #ff5252));
      transform: translateX(-4px);
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "schedule-editor-card": ScheduleEditorCard;
  }
  interface Window {
    customCards: Array<Record<string, unknown>>;
  }
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "schedule-editor-card",
  name: "Schedule Editor Card",
  description: "Create, edit, duplicate and delete native Home Assistant schedule helpers.",
});
