/**
 * ObsidianCode - OMC HUD view
 *
 * Sticky status bar at the bottom of the chat container that renders
 * the latest HUDData from OMCHUDProvider (model, context usage, effort
 * level, session cost, active subagents).
 *
 * Desktop-only; `show()` is a no-op on mobile. The host is responsible
 * for subscribing the view's `update` method to the provider.
 */

import { Platform } from 'obsidian';

import type { HUDData } from '../../core/omc/OMCHUDProvider';

export class OMCHUDView {
  private el: HTMLElement;
  private visible = false;

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
    this.el.empty();
    this.el.createSpan({ text: '[OMC]' });

    const sep = () => this.el.createSpan({ text: ' │ ' });

    if (data.model) {
      sep();
      this.el.createSpan({ text: data.model });
    }
    if (data.contextPercent !== null) {
      sep();
      const pct = data.contextPercent;
      const cls =
        pct >= 85 ? 'oc-hud-critical' : pct >= 70 ? 'oc-hud-warning' : '';
      this.el.createSpan({ cls, text: `ctx:${pct}%` });
    }
    if (data.effort) {
      sep();
      this.el.createSpan({ text: `effort:${data.effort}` });
    }
    if (data.costUsd !== null) {
      sep();
      this.el.createSpan({ text: `$${data.costUsd.toFixed(2)}` });
    }
    if (data.activeAgents !== null && data.activeAgents > 0) {
      sep();
      this.el.createSpan({ text: `agents:${data.activeAgents}` });
    }
  }

  destroy(): void {
    this.el.remove();
  }
}
