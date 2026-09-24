import { LitElement, html, css, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { CardConfig, HomeAssistant } from "./types";

/**
 * Shared visual config editor for both cards - they take the exact same
 * config shape (type/title/entities), so one implementation covers both,
 * registered under two tag names so each card's getConfigElement() can
 * request its own (HA doesn't require per-card-type editor elements to be
 * distinct implementations, just distinct tags it can create()).
 */
export class ScheduleCardEditorBase extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @state() private config?: CardConfig;

  setConfig(config: CardConfig): void {
    this.config = { ...config };
  }

  private fireChange(patch: Partial<CardConfig>): void {
    if (!this.config) return;
    const next: CardConfig = { ...this.config, ...patch };
    if (!next.title) delete next.title;
    if (!next.entities || next.entities.length === 0) delete next.entities;
    this.config = next;
    this.dispatchEvent(
      new CustomEvent("config-changed", { detail: { config: next }, bubbles: true, composed: true })
    );
  }

  render(): TemplateResult {
    if (!this.config) return html``;
    return html`
      <div class="form">
        <div class="row">
          <label for="title">Title (optional)</label>
          <input
            id="title"
            type="text"
            .value=${this.config.title ?? ""}
            @change=${(e: Event) => this.fireChange({ title: (e.target as HTMLInputElement).value })}
          />
        </div>
        <div class="row">
          <span class="label">Schedules (leave empty to show every schedule.* entity)</span>
          <ha-selector
            .hass=${this.hass}
            .selector=${{ entity: { domain: "schedule", multiple: true } }}
            .value=${this.config.entities ?? []}
            @value-changed=${(e: CustomEvent<{ value: string[] }>) => this.fireChange({ entities: e.detail.value })}
          ></ha-selector>
        </div>
      </div>
    `;
  }

  static styles = css`
    .form {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 8px 2px;
    }
    .row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    label,
    .label {
      font-size: 0.9em;
      color: var(--secondary-text-color);
    }
    input[type="text"] {
      font: inherit;
      color: var(--primary-text-color);
      background: var(--card-background-color);
      border: 1px solid var(--divider-color);
      border-radius: 4px;
      padding: 8px;
    }
  `;
}

@customElement("schedule-editor-card-editor")
export class ScheduleEditorCardEditor extends ScheduleCardEditorBase {}

@customElement("schedule-timeline-card-editor")
export class ScheduleTimelineCardEditor extends ScheduleCardEditorBase {}

declare global {
  interface HTMLElementTagNameMap {
    "schedule-editor-card-editor": ScheduleEditorCardEditor;
    "schedule-timeline-card-editor": ScheduleTimelineCardEditor;
  }
}
