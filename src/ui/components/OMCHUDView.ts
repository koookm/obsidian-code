/**
 * ObsidianCode - OMC HUD view
 *
 * Sticky status bar at the bottom of the chat container.
 * Default: collapsed — shows "[OMC vX.Y.Z]" only.
 * Click label to expand: model, ctx, 5h/7d rate limits, effort, cost, skills, agents.
 *
 * Desktop-only; `show()` is a no-op on mobile.
 */

import { Platform } from 'obsidian';

import type { HUDData } from '../../core/omc/OMCHUDProvider';

export class OMCHUDView {
  private el: HTMLElement;
  private visible = false;
  private collapsed = true;
  private lastData: HUDData | null = null;

  /** container must be the inner chat container, not the leaf root */
  constructor(container: HTMLElement) {
    this.el = container.createDiv({ cls: 'oc-omc-hud' });
    this.el.style.display = 'none';
  }

  show(): void {
    if (!Platform.isDesktop) return;
    this.el.style.display = '';
    this.visible = true;
  }

  hide(): void {
    this.el.style.display = 'none';
    this.visible = false;
  }

  update(data: HUDData): void {
    if (!this.visible) return;
    this.lastData = data;
    this.render();
  }

  private render(): void {
    if (!this.lastData) return;
    const data = this.lastData;
    this.el.empty();

    const label = data.version ? `OMC v${data.version}` : 'OMC';
    const labelSpan = this.el.createSpan({ cls: 'oc-hud-label', text: `[${label}]` });
    labelSpan.title = this.collapsed ? 'Click to expand' : 'Click to collapse';
    labelSpan.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.render();
    });

    if (this.collapsed) return;

    const sep = () => this.el.createSpan({ text: ' │ ' });

    if (data.model) {
      sep();
      this.el.createSpan({ text: data.model });
    }

    if (data.contextPercent !== null) {
      sep();
      const pct = data.contextPercent;
      const cls = pct >= 85 ? 'oc-hud-critical' : pct >= 70 ? 'oc-hud-warning' : '';
      this.el.createSpan({ cls, text: `ctx:${pct}%` });
    }

    if (data.fiveHourPercent !== null) {
      sep();
      const pct = data.fiveHourPercent;
      const cls = pct >= 85 ? 'oc-hud-critical' : pct >= 70 ? 'oc-hud-warning' : '';
      this.el.createSpan({ cls, text: `5h:${pct}%` });
    }

    if (data.sevenDayPercent !== null) {
      sep();
      const pct = data.sevenDayPercent;
      const cls = pct >= 85 ? 'oc-hud-critical' : pct >= 70 ? 'oc-hud-warning' : '';
      this.el.createSpan({ cls, text: `7d:${pct}%` });
    }

    if (data.effort) {
      sep();
      this.el.createSpan({ text: `effort:${data.effort}` });
    }

    if (data.costUsd !== null) {
      sep();
      this.el.createSpan({ text: `$${data.costUsd.toFixed(2)}` });
    }

    if (data.skillsCount !== null && data.skillsCount > 0) {
      sep();
      this.el.createSpan({ text: `skills:${data.skillsCount}` });
    }

    if (data.activeAgents !== null && data.activeAgents > 0) {
      sep();
      this.el.createSpan({ text: `agents:${data.activeAgents}` });
    }

    const hasData = data.model !== null || data.contextPercent !== null || data.costUsd !== null;
    if (!hasData) {
      sep();
      this.el.createSpan({ cls: 'oc-hud-idle', text: 'idle' });
    }
  }

  destroy(): void {
    this.el.remove();
  }
}
