import { LitElement, html, css, TemplateResult, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { AutomationBinding, CardConfig, HomeAssistant, ScheduleBlock, ScheduleRecord, WEEKDAYS, Weekday } from "./types";
import { createSchedule, daysOf, deleteSchedule, errorMessage, listSchedules, updateSchedule, emptyDays } from "./schedule-api";
import { deleteBinding, getBinding, saveBinding } from "./automation-api";
import { currentMinutesOfDay, hasOverlap, percentOfDay, toMinutes } from "./time-utils";

const DAY_LABEL: Record<Weekday, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

// getDay() is 0=Sunday..6=Saturday; WEEKDAYS is Monday-first.
const JS_DAY_TO_WEEKDAY: Weekday[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

interface NewBlockDraft {
  day: Weekday;
  from: string;
  to: string;
}

interface FlatBlock {
  day: Weekday;
  index: number;
  block: ScheduleBlock;
}

@customElement("schedule-editor-card")
export class ScheduleEditorCard extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @state() private config!: CardConfig;
  @state() private schedules: ScheduleRecord[] = [];
  @state() private loading = true;
  @state() private error: string | null = null;
  @state() private expandedTimelines: Set<string> = new Set();
  @state() private editingBlock: { scheduleId: string; day: Weekday; index: number } | null = null;
  @state() private editBlockDraft: { from: string; to: string } = { from: "00:00", to: "00:30" };
  @state() private newBlockDrafts: Record<string, NewBlockDraft> = {};
  @state() private expandedBindings: Set<string> = new Set();
  // undefined = not fetched yet, null = fetched, no binding exists.
  @state() private bindings: Record<string, AutomationBinding | null | undefined> = {};
  @state() private editingIconFor: string | null = null;

  private nowTimer?: number;
  private todayWeekday: Weekday = JS_DAY_TO_WEEKDAY[new Date().getDay()];

  setConfig(config: CardConfig): void {
    this.config = { type: config.type, title: config.title, entities: config.entities };
  }

  getCardSize(): number {
    return 2 + this.schedules.length * 2;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.refresh();
    // Re-render the "now" line every minute; no need to re-fetch schedules for this.
    this.nowTimer = window.setInterval(() => {
      this.todayWeekday = JS_DAY_TO_WEEKDAY[new Date().getDay()];
      this.requestUpdate();
    }, 60_000);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.nowTimer) window.clearInterval(this.nowTimer);
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
  }

  private entityIdFor(scheduleId: string): string {
    return `schedule.${scheduleId}`;
  }

  private stateOf(scheduleId: string): string | undefined {
    return this.hass?.states?.[this.entityIdFor(scheduleId)]?.state;
  }

  private flatBlocks(record: ScheduleRecord): FlatBlock[] {
    const days = daysOf(record);
    const out: FlatBlock[] = [];
    for (const day of WEEKDAYS) {
      days[day].forEach((block, index) => out.push({ day, index, block }));
    }
    return out;
  }

  private draftFor(scheduleId: string): NewBlockDraft {
    return this.newBlockDrafts[scheduleId] ?? { day: this.todayWeekday, from: "00:00", to: "00:30" };
  }

  private updateDraft(scheduleId: string, patch: Partial<NewBlockDraft>): void {
    this.newBlockDrafts = {
      ...this.newBlockDrafts,
      [scheduleId]: { ...this.draftFor(scheduleId), ...patch },
    };
  }

  private toggleTimeline(scheduleId: string): void {
    const next = new Set(this.expandedTimelines);
    if (next.has(scheduleId)) next.delete(scheduleId);
    else next.add(scheduleId);
    this.expandedTimelines = next;
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

  private async persistDays(record: ScheduleRecord, day: Weekday, blocks: ScheduleBlock[]): Promise<void> {
    const days = daysOf(record);
    days[day] = blocks;
    try {
      const updated = await updateSchedule(this.hass, record.id, record.name, record.icon, days);
      this.schedules = this.schedules.map((s) => (s.id === record.id ? updated : s));
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  private handleStartEditBlock(scheduleId: string, day: Weekday, index: number, block: ScheduleBlock): void {
    this.editingBlock = { scheduleId, day, index };
    this.editBlockDraft = { from: block.from.slice(0, 5), to: block.to.slice(0, 5) };
  }

  private handleCancelEditBlock(): void {
    this.editingBlock = null;
  }

  private async handleSaveEditBlock(record: ScheduleRecord): Promise<void> {
    if (!this.editingBlock || this.editingBlock.scheduleId !== record.id) return;
    const { day, index } = this.editingBlock;
    const from = `${this.editBlockDraft.from}:00`;
    const to = `${this.editBlockDraft.to}:00`;
    if (toMinutes(from) >= toMinutes(to)) {
      this.error = "Start time must be before end time.";
      return;
    }
    const existing = daysOf(record)[day];
    const candidate = existing.map((b, i) => (i === index ? { from, to } : b));
    if (hasOverlap(candidate)) {
      this.error = "That block overlaps an existing one on this day.";
      return;
    }
    this.error = null;
    this.editingBlock = null;
    await this.persistDays(record, day, candidate);
  }

  private async handleAddBlock(record: ScheduleRecord): Promise<void> {
    const draft = this.draftFor(record.id);
    const from = `${draft.from}:00`;
    const to = `${draft.to}:00`;
    if (toMinutes(from) >= toMinutes(to)) {
      this.error = "Start time must be before end time.";
      return;
    }
    const existing = daysOf(record)[draft.day];
    const candidate = [...existing, { from, to }];
    if (hasOverlap(candidate)) {
      this.error = "That block overlaps an existing one on that day.";
      return;
    }
    this.error = null;
    this.updateDraft(record.id, { from: "00:00", to: "00:30" });
    await this.persistDays(record, draft.day, candidate);
  }

  private async handleRemoveBlock(record: ScheduleRecord, day: Weekday, index: number): Promise<void> {
    const existing = daysOf(record)[day];
    const next = existing.filter((_, i) => i !== index);
    await this.persistDays(record, day, next);
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
    const blocks = this.flatBlocks(record);
    const binding = this.bindings[record.id];
    const boundCount = binding?.entities.length ?? 0;
    return html`
      <div class="schedule">
        <div class="schedule-header">
          <ha-icon-button
            title=${expanded ? "Hide weekly view" : "Show weekly view"}
            @click=${() => this.toggleTimeline(record.id)}
          >
            <ha-icon icon=${expanded ? "mdi:chevron-down" : "mdi:chevron-right"}></ha-icon>
          </ha-icon-button>
          <button
            class="icon-button"
            title="Change icon"
            @click=${() => this.toggleIconEditor(record.id)}
          >
            <ha-icon icon=${record.icon || "mdi:calendar-clock"}></ha-icon>
          </button>
          <span class="name">${record.name}</span>
          <span class="pill ${isOn ? "on" : "off"}">${isOn ? "Active now" : "Idle"}</span>
          <span class="spacer"></span>
          <ha-icon-button
            title=${boundCount > 0 ? `Controls ${boundCount} ${boundCount === 1 ? "entity" : "entities"}` : "Controls: none set"}
            class=${boundCount > 0 ? "has-binding" : ""}
            @click=${() => this.toggleBindingPanel(record.id)}
          >
            <ha-icon icon="mdi:power-plug-outline"></ha-icon>
          </ha-icon-button>
          <ha-icon-button @click=${() => this.handleDuplicate(record)} title="Duplicate">
            <ha-icon icon="mdi:content-copy"></ha-icon>
          </ha-icon-button>
          <ha-icon-button @click=${() => this.handleDelete(record)} title="Delete">
            <ha-icon icon="mdi:delete"></ha-icon>
          </ha-icon-button>
        </div>

        ${this.editingIconFor === record.id ? this.renderIconEditor(record) : nothing}
        ${bindingsOpen ? this.renderBindingPanel(record) : nothing}

        <div class="block-list">
          ${blocks.length === 0
            ? html`<div class="muted">No blocks yet.</div>`
            : blocks.map((fb) => this.renderBlockChip(record, fb))}
          ${this.renderAddBlockForm(record)}
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

  private renderBlockChip(record: ScheduleRecord, fb: FlatBlock): TemplateResult {
    const { day, index, block } = fb;
    const isEditing =
      this.editingBlock?.scheduleId === record.id &&
      this.editingBlock?.day === day &&
      this.editingBlock?.index === index;

    if (isEditing) {
      return html`
        <div class="block-chip editing">
          <span class="chip-day">${DAY_LABEL[day]}</span>
          <input
            type="time"
            .value=${this.editBlockDraft.from}
            @change=${(e: Event) =>
              (this.editBlockDraft = { ...this.editBlockDraft, from: (e.target as HTMLInputElement).value })}
          />
          <span>–</span>
          <input
            type="time"
            .value=${this.editBlockDraft.to}
            @change=${(e: Event) =>
              (this.editBlockDraft = { ...this.editBlockDraft, to: (e.target as HTMLInputElement).value })}
          />
          <button title="Save" @click=${() => this.handleSaveEditBlock(record)}>✓</button>
          <button title="Cancel" @click=${() => this.handleCancelEditBlock()}>×</button>
        </div>
      `;
    }

    return html`
      <div class="block-chip">
        <button
          class="chip-text"
          title="Click to edit"
          @click=${() => this.handleStartEditBlock(record.id, day, index, block)}
        >
          <span class="chip-day">${DAY_LABEL[day]}</span>
          ${block.from.slice(0, 5)}–${block.to.slice(0, 5)}
        </button>
        <button title="Delete" @click=${() => this.handleRemoveBlock(record, day, index)}>×</button>
      </div>
    `;
  }

  private renderAddBlockForm(record: ScheduleRecord): TemplateResult {
    const draft = this.draftFor(record.id);
    return html`
      <div class="add-block">
        <select
          .value=${draft.day}
          @change=${(e: Event) => this.updateDraft(record.id, { day: (e.target as HTMLSelectElement).value as Weekday })}
        >
          ${WEEKDAYS.map((d) => html`<option value=${d} ?selected=${d === draft.day}>${DAY_LABEL[d]}</option>`)}
        </select>
        <input
          type="time"
          .value=${draft.from}
          @change=${(e: Event) => this.updateDraft(record.id, { from: (e.target as HTMLInputElement).value })}
        />
        <span>to</span>
        <input
          type="time"
          .value=${draft.to}
          @change=${(e: Event) => this.updateDraft(record.id, { to: (e.target as HTMLInputElement).value })}
        />
        <mwc-button @click=${() => this.handleAddBlock(record)}>+ Add</mwc-button>
      </div>
    `;
  }

  private renderDayRow(record: ScheduleRecord, day: Weekday): TemplateResult {
    const blocks = daysOf(record)[day];
    const isToday = day === this.todayWeekday;
    const nowPct = (currentMinutesOfDay() / 1440) * 100;

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
                <div class="now-marker" style="left:${nowPct}%" title="Now"></div>
                <div class="now-line" style="left:${nowPct}%"></div>
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
    .chip-day {
      font-weight: 500;
      color: var(--secondary-text-color);
      margin-right: 4px;
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
