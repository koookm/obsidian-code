/**
 * ObsidianCode - OMC HUD provider
 *
 * Polls `<vault>/.omc/state/` for the real OMC runtime signals
 * (`hud-stdin-cache.json`, `subagent-tracking.json`) and pushes
 * updates to subscribed listeners. Uses exponential backoff on read
 * failure so a missing or transiently locked state dir can't hot-loop
 * the file system.
 *
 * We read from the vault path rather than `process.cwd()` because on
 * desktop Obsidian the process cwd is the Obsidian binary directory,
 * not the user's workspace.
 *
 * Desktop-only — start() is a no-op on mobile.
 */

import * as fs from 'fs';
import { Platform } from 'obsidian';
import * as path from 'path';

import type { OMCInstall } from './OMCDetector';

export interface HUDData {
  model: string | null;
  contextPercent: number | null;
  effort: string | null;
  costUsd: number | null;
  activeAgents: number | null;
}

type HUDListener = (data: HUDData) => void;

const EMPTY: HUDData = {
  model: null,
  contextPercent: null,
  effort: null,
  costUsd: null,
  activeAgents: null,
};

export class OMCHUDProvider {
  private vaultPath: string;
  private listeners: HUDListener[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failCount = 0;
  private readonly BASE_INTERVAL = 300;
  private readonly MAX_INTERVAL = 5000;

  constructor(
    _install: Pick<OMCInstall, 'pluginRoot' | 'cliPath'>,
    vaultPath: string
  ) {
    this.vaultPath = vaultPath;
  }

  async readStateFiles(): Promise<HUDData> {
    const stateDir = path.join(this.vaultPath, '.omc', 'state');
    if (!fs.existsSync(stateDir)) return { ...EMPTY };

    const result: HUDData = { ...EMPTY };

    const hudCache = readJson(
      path.join(stateDir, 'hud-stdin-cache.json')
    ) as HudStdinCache | null;
    if (hudCache) {
      result.model = hudCache.model?.display_name ?? null;
      const pct = hudCache.context_window?.used_percentage;
      result.contextPercent = typeof pct === 'number' ? pct : null;
      result.effort = hudCache.effort?.level ?? null;
      const cost = hudCache.cost?.total_cost_usd;
      result.costUsd = typeof cost === 'number' ? cost : null;
    }

    const subagents = readJson(
      path.join(stateDir, 'subagent-tracking.json')
    ) as SubagentTracking | null;
    if (subagents && Array.isArray(subagents.agents)) {
      result.activeAgents = subagents.agents.length;
    }

    return result;
  }

  on(listener: HUDListener): void {
    this.listeners.push(listener);
  }

  off(listener: HUDListener): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  start(): void {
    if (!Platform.isDesktop || this.timer) return;
    this.schedule();
  }

  private schedule(): void {
    const interval = Math.min(
      this.BASE_INTERVAL * Math.pow(2, this.failCount),
      this.MAX_INTERVAL
    );
    this.timer = setTimeout(async () => {
      try {
        const data = await this.readStateFiles();
        this.failCount = 0;
        for (const l of this.listeners) l(data);
      } catch {
        this.failCount++;
      }
      this.timer = null;
      if (this.listeners.length > 0) this.schedule();
    }, interval);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.listeners = [];
  }
}

interface HudStdinCache {
  model?: { id?: string; display_name?: string };
  context_window?: { used_percentage?: number };
  effort?: { level?: string };
  cost?: { total_cost_usd?: number };
}

interface SubagentTracking {
  agents?: unknown[];
}

function readJson(filePath: string): unknown {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}
