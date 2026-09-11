import { LitElement, html, css, PropertyValues, TemplateResult, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { CardConfig, HomeAssistant, ScheduleBlock, ScheduleRecord, WEEKDAYS, Weekday } from "./types";
import { createSchedule, daysOf, deleteSchedule, errorMessage, listSchedules, updateSchedule, emptyDays } from "./schedule-api";
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

@customElement("schedule-editor-card")
export class ScheduleEditorCard extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @state() private config!: CardConfig;
  @state() private schedules: ScheduleRecord[] = [];
  @state() private loading = true;
  @state() private error: string | null = null;
  @state() private openEditor: { scheduleId: string; day: Weekday } | null = null;
  @state() private newBlockDraft: { from: string; to: string } = { from: "00:00", to: "00:30" };
  @state() private editingBlockIndex: number | null = null;
  @state() private editBlockDraft: { from: string; to: string } = { from: "00:00", to: "00:30" };

  private nowTimer?: number;
  private todayWeekday: Weekday = JS_DAY_TO_WEEKDAY[new Date().getDay()];

  setConfig(config: CardConfig): void {
    this.config = { type: config.type, title: config.title, entities: config.entities };
  }

  getCardSize(): number {
    return 2 + this.schedules.length * 3;
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

  private toggleEditor(scheduleId: string, day: Weekday): void {
    this.editingBlockIndex = null;
    if (this.openEditor && this.openEditor.scheduleId === scheduleId && this.openEditor.day === day) {
      this.openEditor = null;
    } else {
      this.openEditor = { scheduleId, day };
      this.newBlockDraft = { from: "00:00", to: "00:30" };
    }
  }

  private handleStartEditBlock(index: number, block: ScheduleBlock): void {
    this.editingBlockIndex = index;
    this.editBlockDraft = { from: block.from.slice(0, 5), to: block.to.slice(0, 5) };
  }

  private handleCancelEditBlock(): void {
    this.editingBlockIndex = null;
  }

  private async handleSaveEditBlock(record: ScheduleRecord, day: Weekday, index: number): Promise<void> {
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
    this.editingBlockIndex = null;
    await this.persistDays(record, day, candidate);
  }

  private async handleAddBlock(record: ScheduleRecord, day: Weekday): Promise<void> {
    const from = `${this.newBlockDraft.from}:00`;
    const to = `${this.newBlockDraft.to}:00`;
    if (toMinutes(from) >= toMinutes(to)) {
      this.error = "Start time must be before end time.";
      return;
    }
    const existing = daysOf(record)[day];
    const candidate = [...existing, { from, to }];
    if (hasOverlap(candidate)) {
      this.error = "That block overlaps an existing one on this day.";
      return;
    }
    this.error = null;
    await this.persistDays(record, day, candidate);
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
    return html`
      <div class="schedule">
        <div class="schedule-header">
          <ha-icon icon=${record.icon || "mdi:calendar-clock"}></ha-icon>
          <span class="name">${record.name}</span>
          <span class="pill ${isOn ? "on" : "off"}">${isOn ? "Active now" : "Idle"}</span>
          <span class="spacer"></span>
          <ha-icon-button @click=${() => this.handleDuplicate(record)} title="Duplicate">
            <ha-icon icon="mdi:content-copy"></ha-icon>
          </ha-icon-button>
          <ha-icon-button @click=${() => this.handleDelete(record)} title="Delete">
            <ha-icon icon="mdi:delete"></ha-icon>
          </ha-icon-button>
        </div>
        <div class="days">
          ${WEEKDAYS.map((day) => this.renderDayRow(record, day))}
        </div>
      </div>
    `;
  }

  private renderDayRow(record: ScheduleRecord, day: Weekday): TemplateResult {
    const blocks = daysOf(record)[day];
    const isEditing =
      this.openEditor?.scheduleId === record.id && this.openEditor?.day === day;
    const isToday = day === this.todayWeekday;
    const nowPct = (currentMinutesOfDay() / 1440) * 100;

    return html`
      <div class="day-row" @click=${() => this.toggleEditor(record.id, day)}>
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
          ${isToday ? html`<div class="now-line" style="left:${nowPct}%"></div>` : nothing}
        </div>
      </div>
      ${isEditing ? this.renderDayEditor(record, day, blocks) : nothing}
    `;
  }

  private renderDayEditor(record: ScheduleRecord, day: Weekday, blocks: ScheduleBlock[]): TemplateResult {
    return html`
      <div class="day-editor" @click=${(e: Event) => e.stopPropagation()}>
        ${blocks.length === 0
          ? html`<div class="muted">No blocks on ${DAY_LABEL[day]}.</div>`
          : blocks.map((b, i) =>
              this.editingBlockIndex === i
                ? html`
                    <div class="block-chip editing">
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
                      <button title="Save" @click=${() => this.handleSaveEditBlock(record, day, i)}>✓</button>
                      <button title="Cancel" @click=${() => this.handleCancelEditBlock()}>×</button>
                    </div>
                  `
                : html`
                    <div class="block-chip">
                      <span>${b.from.slice(0, 5)}–${b.to.slice(0, 5)}</span>
                      <button title="Edit" @click=${() => this.handleStartEditBlock(i, b)}>✎</button>
                      <button title="Delete" @click=${() => this.handleRemoveBlock(record, day, i)}>×</button>
                    </div>
                  `
            )}
        <div class="add-block">
          <input
            type="time"
            .value=${this.newBlockDraft.from}
            @change=${(e: Event) =>
              (this.newBlockDraft = { ...this.newBlockDraft, from: (e.target as HTMLInputElement).value })}
          />
          <span>to</span>
          <input
            type="time"
            .value=${this.newBlockDraft.to}
            @change=${(e: Event) =>
              (this.newBlockDraft = { ...this.newBlockDraft, to: (e.target as HTMLInputElement).value })}
          />
          <mwc-button @click=${() => this.handleAddBlock(record, day)}>Add</mwc-button>
        </div>
      </div>
    `;
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
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
      gap: 8px;
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
    .days {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .day-row {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
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
      overflow: hidden;
    }
    .block {
      position: absolute;
      top: 0;
      bottom: 0;
      background: var(--state-active-color, #2196f3);
    }
    .now-line {
      position: absolute;
      top: -2px;
      bottom: -2px;
      width: 2px;
      background: var(--warning-color, #ffca28);
    }
    .day-editor {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      padding: 6px 0 6px 40px;
      cursor: default;
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
      padding: 2px 4px 2px 10px;
      font-size: 0.85em;
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
