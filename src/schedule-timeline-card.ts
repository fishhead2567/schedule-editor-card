import { LitElement, html, css, TemplateResult, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { CardConfig, HomeAssistant, ScheduleRecord, Weekday } from "./types";
import { daysOf, errorMessage, listSchedules } from "./schedule-api";
import { getColors, DEFAULT_COLOR } from "./user-data-api";
import { currentMinutesOfDay, percentOfDay, toMinutes } from "./time-utils";

const JS_DAY_TO_WEEKDAY: Weekday[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_FULL_LABEL: Record<Weekday, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};
const HOURS = Array.from({ length: 24 }, (_, h) => h);

function formatHourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${hour < 12 ? "am" : "pm"}`;
}

function formatTimeLabel(date: Date): string {
  let h = date.getHours();
  const m = date.getMinutes();
  const suffix = h < 12 ? "AM" : "PM";
  h = h % 12 === 0 ? 12 : h % 12;
  return `${h}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * A read-only, at-a-glance companion to schedule-editor-card: one track per
 * schedule, today's blocks only, a shared "now" line moving across all of
 * them together. Deliberately does not duplicate the editor card's CRUD -
 * click a track's icon for the name, that's it; edit from the other card.
 */
@customElement("schedule-timeline-card")
export class ScheduleTimelineCard extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @state() private config!: CardConfig;
  @state() private schedules: ScheduleRecord[] = [];
  @state() private colors: Record<string, string> = {};
  @state() private loading = true;
  @state() private error: string | null = null;
  @state() private activeTooltip: string | null = null;

  private nowTimer?: number;
  private todayWeekday: Weekday = JS_DAY_TO_WEEKDAY[new Date().getDay()];

  setConfig(config: CardConfig): void {
    this.config = { type: config.type, title: config.title, entities: config.entities };
  }

  getCardSize(): number {
    return 3 + this.schedules.length;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.refresh();
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
      const [all, colors] = await Promise.all([listSchedules(this.hass), getColors(this.hass)]);
      const wanted = this.config.entities;
      this.schedules = wanted ? all.filter((s) => wanted.includes(`schedule.${s.id}`)) : all;
      this.colors = colors;
    } catch (e) {
      this.error = errorMessage(e);
    } finally {
      this.loading = false;
    }
  }

  private colorOf(scheduleId: string): string {
    return this.colors[scheduleId] ?? DEFAULT_COLOR;
  }

  private toggleTooltip(scheduleId: string): void {
    this.activeTooltip = this.activeTooltip === scheduleId ? null : scheduleId;
  }

  render(): TemplateResult {
    if (this.loading) {
      return html`<ha-card><div class="pad">Loading timeline…</div></ha-card>`;
    }
    const now = new Date();
    const nowPct = (currentMinutesOfDay() / 1440) * 100;
    return html`
      <ha-card>
        <div class="header">
          <div class="title-group">
            <div class="title">${this.config.title ?? "Timeline"}</div>
            <div class="subtitle">Today · ${WEEKDAY_FULL_LABEL[this.todayWeekday]}</div>
          </div>
        </div>
        ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
        ${this.schedules.length === 0
          ? html`<div class="pad">No schedules yet.</div>`
          : html`
              <div class="chart">
                <div class="axis-spacer"></div>
                <div class="axis-bar">
                  ${HOURS.map(
                    (h) => html`
                      <div class="hour-tick" style="left:${(h / 24) * 100}%">
                        ${h % 3 === 0 ? html`<span class="hour-label">${formatHourLabel(h)}</span>` : nothing}
                      </div>
                    `
                  )}
                </div>
                ${this.schedules.map((record) => this.renderTrack(record))}
                <div class="overlay">
                  ${HOURS.map((h) => html`<div class="grid-line" style="left:${(h / 24) * 100}%"></div>`)}
                  <div class="now-line" style="left:${nowPct}%"></div>
                  <div class="now-label" style="left:${nowPct}%">${formatTimeLabel(now)}</div>
                </div>
              </div>
            `}
      </ha-card>
    `;
  }

  private renderTrack(record: ScheduleRecord): TemplateResult {
    const blocks = daysOf(record)[this.todayWeekday];
    const color = this.colorOf(record.id);
    const nowMin = currentMinutesOfDay();
    return html`
      <button class="track-icon" title=${record.name} @click=${() => this.toggleTooltip(record.id)}>
        <ha-icon icon=${record.icon || "mdi:calendar-clock"}></ha-icon>
      </button>
      <div class="track-timeline">
        ${this.activeTooltip === record.id ? html`<div class="tooltip">${record.name}</div>` : nothing}
        ${blocks.map((b) => {
          const active = toMinutes(b.from) <= nowMin && nowMin < toMinutes(b.to);
          return html`
            <div
              class="track-block ${active ? "active" : ""}"
              style="left:${percentOfDay(b.from)}%; width:${percentOfDay(b.to) - percentOfDay(b.from)}%; background:${color}"
              title="${b.from.slice(0, 5)}–${b.to.slice(0, 5)}"
            ></div>
          `;
        })}
      </div>
    `;
  }

  static styles = css`
    .header {
      display: flex;
      align-items: center;
      padding: 12px 16px 8px;
    }
    .title {
      font-size: 1.2em;
      font-weight: 500;
    }
    .subtitle {
      font-size: 0.8em;
      color: var(--secondary-text-color);
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
    /*
     * A CSS grid, not flexbox, specifically so the hour axis, the gridline/
     * now-line overlay, and every track's bar area share the exact same
     * column - the overlay is an absolutely-positioned grid item placed in
     * that same column across every row, which guarantees its percentage-
     * based positions land in the same pixels as the bars underneath it,
     * rather than approximating the offset with matching padding.
     */
    .chart {
      position: relative;
      display: grid;
      grid-template-columns: 32px 1fr;
      align-items: center;
      row-gap: 6px;
      padding: 4px 16px 20px;
    }
    .axis-spacer {
      grid-column: 1;
    }
    .axis-bar {
      grid-column: 2;
      position: relative;
      height: 16px;
    }
    .hour-tick {
      position: absolute;
      top: 0;
      bottom: 0;
    }
    .hour-label {
      position: absolute;
      top: 0;
      left: 2px;
      font-size: 0.68em;
      color: var(--secondary-text-color);
      white-space: nowrap;
    }
    .track-icon {
      grid-column: 1;
      border: none;
      background: none;
      cursor: pointer;
      padding: 4px;
      display: flex;
      justify-content: center;
      color: var(--secondary-text-color);
    }
    .track-timeline {
      grid-column: 2;
      position: relative;
      height: 18px;
      background: var(--divider-color);
      border-radius: 3px;
      overflow: visible;
    }
    .tooltip {
      position: absolute;
      left: 0;
      top: -26px;
      z-index: 2;
      background: var(--card-background-color, white);
      border: 1px solid var(--divider-color);
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 0.8em;
      box-shadow: var(--ha-card-box-shadow, 0 2px 4px rgba(0, 0, 0, 0.2));
      white-space: nowrap;
    }
    .track-block {
      position: absolute;
      top: 0;
      bottom: 0;
      border-radius: 3px;
      opacity: 0.45;
    }
    .track-block.active {
      opacity: 1;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.15) inset;
    }
    /* Spans the bar column across every row (axis + all tracks) - see the
     * .chart comment above for why a grid makes this line up exactly. */
    .overlay {
      grid-column: 2;
      grid-row: 1 / -1;
      position: relative;
      pointer-events: none;
    }
    .grid-line {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 0;
      /* Deliberately not --divider-color: the track bars themselves use
       * that color, which made the gridlines invisible on top of them. */
      border-left: 1px dotted var(--secondary-text-color);
      opacity: 0.6;
    }
    /* Shared playhead across every track, same visual language as the
     * editor card's now-indicator (a line, not a block) for consistency. */
    .now-line {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 1.5px;
      background: var(--now-line-color, var(--error-color, #ff5252));
    }
    .now-label {
      position: absolute;
      top: -18px;
      transform: translateX(-50%);
      font-size: 0.68em;
      font-weight: 500;
      color: var(--now-line-color, var(--error-color, #ff5252));
      white-space: nowrap;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "schedule-timeline-card": ScheduleTimelineCard;
  }
  interface Window {
    customCards: Array<Record<string, unknown>>;
  }
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "schedule-timeline-card",
  name: "Schedule Timeline Card",
  description: "A live, multi-track timeline overview of your schedules for today.",
});
