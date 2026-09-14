import { LitElement, html, css, TemplateResult, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { CardConfig, HomeAssistant, ScheduleRecord, Weekday } from "./types";
import { daysOf, errorMessage, listSchedules } from "./schedule-api";
import { getColors, DEFAULT_COLOR } from "./user-data-api";
import { currentMinutesOfDay, percentOfDay, toMinutes } from "./time-utils";

const JS_DAY_TO_WEEKDAY: Weekday[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

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
    return 2 + this.schedules.length;
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
    const nowPct = (currentMinutesOfDay() / 1440) * 100;
    return html`
      <ha-card>
        <div class="header">
          <div class="title">${this.config.title ?? "Timeline"}</div>
        </div>
        ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
        ${this.schedules.length === 0
          ? html`<div class="pad">No schedules yet.</div>`
          : html`
              <div class="tracks">
                ${this.schedules.map((record) => this.renderTrack(record))}
                <div class="now-line" style="left:${nowPct}%"></div>
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
      <div class="track">
        <button
          class="track-icon"
          title=${record.name}
          @click=${() => this.toggleTooltip(record.id)}
        >
          <ha-icon icon=${record.icon || "mdi:calendar-clock"}></ha-icon>
        </button>
        ${this.activeTooltip === record.id ? html`<div class="tooltip">${record.name}</div>` : nothing}
        <div class="track-timeline">
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
    .tracks {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 4px 16px 16px;
    }
    .track {
      position: relative;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .track-icon {
      border: none;
      background: none;
      cursor: pointer;
      padding: 4px;
      display: flex;
      color: var(--secondary-text-color);
      flex-shrink: 0;
    }
    .tooltip {
      position: absolute;
      left: 32px;
      top: -2px;
      z-index: 2;
      background: var(--card-background-color, white);
      border: 1px solid var(--divider-color);
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 0.8em;
      box-shadow: var(--ha-card-box-shadow, 0 2px 4px rgba(0, 0, 0, 0.2));
      white-space: nowrap;
    }
    .track-timeline {
      position: relative;
      flex: 1;
      height: 18px;
      background: var(--divider-color);
      border-radius: 3px;
      overflow: hidden;
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
    /* Shared playhead across every track, same visual language as the
     * editor card's now-indicator (a line, not a block) for consistency. */
    .now-line {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 1.5px;
      background: var(--now-line-color, var(--error-color, #ff5252));
      pointer-events: none;
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
