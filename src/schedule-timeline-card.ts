import { LitElement, html, css, TemplateResult, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { CardConfig, HomeAssistant, ScheduleRecord, Weekday } from "./types";
import { daysOf, errorMessage, listSchedules } from "./schedule-api";
import { getColors, DEFAULT_COLOR } from "./user-data-api";
import {
  addDaysToWeekday,
  currentMinutesInZone,
  dateLabelForOffset,
  percentOfDay,
  todayWeekdayInZone,
  toMinutes,
} from "./time-utils";

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

function formatTimeLabel(date: Date, timeZone: string | undefined): string {
  const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/**
 * A read-only, at-a-glance companion to schedule-editor-card: one track per
 * schedule, a shared "now" line moving across all of them together on
 * today's view, and arrows to step through other days to see what's coming
 * up. Deliberately does not duplicate the editor card's CRUD - click a
 * track's icon for the name, that's it; edit from the other card.
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
  /** 0 = today, 1 = tomorrow, -1 = yesterday, etc. Purely a display
   * choice - navigating never changes any schedule data. */
  @state() private dayOffset = 0;

  private nowTimer?: number;
  // Placeholder until connectedCallback can consult hass.config.time_zone;
  // todayWeekdayInZone/currentMinutesInZone fall back to the browser's own
  // zone if hass isn't ready yet, so this is never actually wrong, just
  // momentarily using the fallback rather than the server's real zone.
  private actualTodayWeekday: Weekday = "monday";

  setConfig(config: CardConfig): void {
    this.config = { type: config.type, title: config.title, entities: config.entities };
  }

  getCardSize(): number {
    return 3 + this.schedules.length;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.refresh();
    this.actualTodayWeekday = todayWeekdayInZone(this.hass?.config?.time_zone);
    this.nowTimer = window.setInterval(() => {
      this.actualTodayWeekday = todayWeekdayInZone(this.hass?.config?.time_zone);
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

  private changeDay(delta: number): void {
    this.dayOffset += delta;
  }

  private goToday(): void {
    this.dayOffset = 0;
  }

  private dateLabel(): string {
    const dateText = dateLabelForOffset(this.hass?.config?.time_zone, this.dayOffset);
    if (this.dayOffset === 0) return `Today · ${dateText}`;
    if (this.dayOffset === 1) return `Tomorrow · ${dateText}`;
    if (this.dayOffset === -1) return `Yesterday · ${dateText}`;
    const viewedWeekday = addDaysToWeekday(this.actualTodayWeekday, this.dayOffset);
    return `${WEEKDAY_FULL_LABEL[viewedWeekday]} · ${dateText}`;
  }

  render(): TemplateResult {
    if (this.loading) {
      return html`<ha-card><div class="pad">Loading timeline…</div></ha-card>`;
    }
    const isToday = this.dayOffset === 0;
    const viewedWeekday = addDaysToWeekday(this.actualTodayWeekday, this.dayOffset);
    const nowPct = isToday ? (currentMinutesInZone(this.hass?.config?.time_zone) / 1440) * 100 : null;
    return html`
      <ha-card>
        <div class="header">
          <div class="title-group">
            <div class="title">${this.config.title ?? "Timeline"}</div>
            <div class="subtitle">
              <ha-icon-button title="Previous day" @click=${() => this.changeDay(-1)}>
                <ha-icon icon="mdi:chevron-left"></ha-icon>
              </ha-icon-button>
              <span class="date-label">${this.dateLabel()}</span>
              <ha-icon-button title="Next day" @click=${() => this.changeDay(1)}>
                <ha-icon icon="mdi:chevron-right"></ha-icon>
              </ha-icon-button>
              ${!isToday ? html`<button class="today-link" @click=${() => this.goToday()}>Today</button>` : nothing}
            </div>
          </div>
        </div>
        ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
        ${this.schedules.length === 0
          ? html`<div class="pad">No schedules yet.</div>`
          : html`
              <div class="chart-wrapper">
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
                  ${this.schedules.map((record) => this.renderTrack(record, viewedWeekday, isToday))}
                </div>
                <div class="overlay">
                  ${HOURS.map((h) => html`<div class="grid-line" style="left:${(h / 24) * 100}%"></div>`)}
                  ${nowPct !== null
                    ? html`
                        <div class="now-line" style="left:${nowPct}%"></div>
                        <div class="now-label" style="left:${nowPct}%">
                          ${formatTimeLabel(new Date(), this.hass?.config?.time_zone)}
                        </div>
                      `
                    : nothing}
                </div>
              </div>
            `}
      </ha-card>
    `;
  }

  private renderTrack(record: ScheduleRecord, weekday: Weekday, isToday: boolean): TemplateResult {
    const blocks = daysOf(record)[weekday];
    const color = this.colorOf(record.id);
    const nowMin = isToday ? currentMinutesInZone(this.hass?.config?.time_zone) : null;
    return html`
      <button class="track-icon" title=${record.name} @click=${() => this.toggleTooltip(record.id)}>
        <ha-icon icon=${record.icon || "mdi:calendar-clock"}></ha-icon>
      </button>
      <div class="track-timeline">
        ${this.activeTooltip === record.id ? html`<div class="tooltip">${record.name}</div>` : nothing}
        ${blocks.map((b) => {
          const active = nowMin !== null && toMinutes(b.from) <= nowMin && nowMin < toMinutes(b.to);
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
      display: flex;
      align-items: center;
      gap: 2px;
      font-size: 0.8em;
      color: var(--secondary-text-color);
    }
    .subtitle ha-icon-button {
      --mdc-icon-button-size: 28px;
      --mdc-icon-size: 18px;
    }
    .date-label {
      min-width: 12em;
      text-align: center;
    }
    .today-link {
      border: none;
      background: none;
      color: var(--primary-color, #03a9f4);
      cursor: pointer;
      font-size: 1em;
      padding: 2px 6px;
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
     * .chart is a grid so the hour axis and every track's bar area share
     * the exact same column (32px icon column + a flexible bar column).
     *
     * The gridline/now-line overlay is deliberately NOT a grid item, after
     * real trouble getting one to work: an item explicitly placed with
     * grid-row line numbers, sharing a column with auto-placed siblings,
     * ended up doubling the row count (auto-placement won't place an item
     * into a cell an explicitly-placed item already occupies, so every
     * auto-placed column-2 item got pushed into a second, separate set of
     * implicit rows instead of reusing the explicit ones) - confirmed via
     * getComputedStyle().gridTemplateRows showing 42 tracks for what
     * should have been 21. Simpler and more robust: .overlay is a plain
     * position:absolute sibling of .chart (both inside .chart-wrapper),
     * positioned with fixed pixel insets that mirror .chart's own known
     * constants (the 32px icon column width, the 16px/4px/20px padding)
     * rather than trying to get the grid to place it. Those numbers have
     * to be kept in sync by hand if the layout constants below change,
     * which is a real but much smaller cost than fighting the grid.
     */
    .chart-wrapper {
      position: relative;
    }
    .chart {
      display: grid;
      grid-template-columns: 32px 1fr;
      align-items: center;
      row-gap: 6px;
      padding: 4px 16px 20px;
    }
    .overlay {
      position: absolute;
      pointer-events: none;
      top: 4px;
      bottom: 20px;
      left: 48px; /* .chart's 16px left padding + the 32px icon column */
      right: 16px; /* .chart's right padding */
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
     * editor card's now-indicator (a line, not a block) for consistency.
     * Only rendered when viewing today - "now" has no meaning on another
     * day's preview. */
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
  description: "A live, multi-track timeline overview of your schedules, with day navigation.",
});
