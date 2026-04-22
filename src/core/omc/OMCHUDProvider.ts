/**
 * ObsidianCode - OMC HUD provider
 *
 * Polls `<vault>/.omc/state/` for OMC runtime signals (active skill,
 * ralph boulder progress, todo counts) and pushes updates to subscribed
 * listeners. Uses exponential backoff on read failure so a missing or
 * transiently locked state dir can't hot-loop the file system.
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
  skill: string | null;
  ralph: { current: number; max: number } | null;
  todos: { done: number; total: number } | null;
  contextPercent?: number;
  agents?: number;
}

type HUDListener = (data: HUDData) => void;

export class OMCHUDProvider {
  private install: Pick<OMCInstall, 'pluginRoot' | 'cliPath'>;
  private vaultPath: string;
  private listeners: HUDListener[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failCount = 0;
  private readonly BASE_INTERVAL = 300;
  private readonly MAX_INTERVAL = 5000;

  constructor(
    install: Pick<OMCInstall, 'pluginRoot' | 'cliPath'>,
    vaultPath: string
  ) {
    this.install = install;
    this.vaultPath = vaultPath;
  }

  static contextPercent(inputTokens: number, contextWindow: number): number {
    if (!contextWindow) return 0;
    return Math.round((inputTokens / contextWindow) * 100);
  }

  async readStateFiles(): Promise<Pick<HUDData, 'skill' | 'ralph' | 'todos'>> {
    const stateDir = path.join(this.vaultPath, '.omc', 'state');
    const result: Pick<HUDData, 'skill' | 'ralph' | 'todos'> = {
      skill: null,
      ralph: null,
      todos: null,
    };
    if (!fs.existsSync(stateDir)) return result;

    try {
      const activeSkillPath = path.join(stateDir, 'active-skill.json');
      if (fs.existsSync(activeSkillPath)) {
        const s = JSON.parse(fs.readFileSync(activeSkillPath, 'utf-8')) as {
          name?: string;
        };
        result.skill = s.name ?? null;
      }
    } catch {
      // Ignore malformed state — HUD shows the last known-good value.
    }

    try {
      const ralphPath = path.join(stateDir, 'ralph.json');
      if (fs.existsSync(ralphPath)) {
        const r = JSON.parse(fs.readFileSync(ralphPath, 'utf-8')) as {
          current?: number;
          max?: number;
        };
        if (typeof r.current === 'number' && typeof r.max === 'number') {
          result.ralph = { current: r.current, max: r.max };
        }
      }
    } catch {
      /* ignore */
    }

    try {
      const todosPath = path.join(stateDir, 'todos.json');
      if (fs.existsSync(todosPath)) {
        const t = JSON.parse(fs.readFileSync(todosPath, 'utf-8')) as {
          done?: number;
          total?: number;
        };
        if (typeof t.done === 'number' && typeof t.total === 'number') {
          result.todos = { done: t.done, total: t.total };
        }
      }
    } catch {
      /* ignore */
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
