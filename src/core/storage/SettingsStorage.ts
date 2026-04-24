/**
 * SettingsStorage - Handles settings.json read/write in vault/.claude/
 *
 * Settings are stored as JSON in the vault's .claude/settings.json file.
 * This replaces the previous approach of storing settings in Obsidian's data.json.
 *
 * User-facing settings go here (including permissions, like Claude Code).
 * Machine-specific state (lastEnvHash, model tracking) stays in Obsidian's data.json.
 */

import type { ObsidianCodeSettings, PlatformBlockedCommands } from '../types';
import { DEFAULT_SETTINGS, getDefaultBlockedCommands, migrateModel } from '../types';
import type { HookCommandSpec, HookMatcher, HooksConfig } from '../types/hooks';
import { HOOK_EVENTS } from '../types/hooks';
import type { VaultFileAdapter } from './VaultFileAdapter';

const MIN_HOOK_TIMEOUT_MS = 1_000;
const MAX_HOOK_TIMEOUT_MS = 300_000;

/** Fields that are machine-specific state or loaded separately. */
type StateFields =
  | 'slashCommands'
  | 'lastEnvHash'
  | 'lastClaudeModel'
  | 'lastCustomModel';

/** Settings stored in .claude/settings.json (user-facing, shareable). */
export type StoredSettings = Omit<ObsidianCodeSettings, StateFields>;

/** Path to settings file relative to vault root. */
export const SETTINGS_PATH = '.claude/settings.json';

function normalizeCommandList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeHookSpec(raw: unknown): HookCommandSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const h = raw as Record<string, unknown>;
  if (h.type !== 'command' || typeof h.command !== 'string') return null;
  const timeout = typeof h.timeout === 'number'
    ? Math.max(MIN_HOOK_TIMEOUT_MS, Math.min(h.timeout, MAX_HOOK_TIMEOUT_MS))
    : undefined;
  return { type: 'command', command: h.command, timeout };
}

function normalizeHookMatcher(raw: unknown): HookMatcher | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (!Array.isArray(m.hooks)) return null;
  if (typeof m.matcher === 'string') {
    try { new RegExp(m.matcher); } catch { return null; }
  }
  const hooks = m.hooks
    .map(normalizeHookSpec)
    .filter((h): h is HookCommandSpec => h !== null);
  return {
    matcher: typeof m.matcher === 'string' ? m.matcher : undefined,
    hooks,
  };
}

export function normalizeHooks(value: unknown): HooksConfig {
  if (!value || typeof value !== 'object') return {};
  const src = value as Record<string, unknown>;
  const out: HooksConfig = {};
  for (const event of HOOK_EVENTS) {
    const matchers = src[event];
    if (!Array.isArray(matchers)) continue;
    out[event] = matchers
      .map(normalizeHookMatcher)
      .filter((m): m is HookMatcher => m !== null);
  }
  return out;
}

function normalizeBlockedCommands(value: unknown): PlatformBlockedCommands {
  const defaults = getDefaultBlockedCommands();

  // Migrate old string[] format to new platform-keyed structure
  if (Array.isArray(value)) {
    return {
      unix: normalizeCommandList(value, defaults.unix),
      windows: [...defaults.windows],
    };
  }

  if (!value || typeof value !== 'object') {
    return defaults;
  }

  const candidate = value as Record<string, unknown>;
  return {
    unix: normalizeCommandList(candidate.unix, defaults.unix),
    windows: normalizeCommandList(candidate.windows, defaults.windows),
  };
}

export class SettingsStorage {
  constructor(private adapter: VaultFileAdapter) {}

  /** Load settings from .claude/settings.json, merging with defaults. */
  async load(): Promise<StoredSettings> {
    try {
      if (!(await this.adapter.exists(SETTINGS_PATH))) {
        return this.getDefaults();
      }

      const content = await this.adapter.read(SETTINGS_PATH);
      const stored = JSON.parse(content) as Record<string, unknown>;
      const blockedCommands = normalizeBlockedCommands(stored.blockedCommands);

      return {
        ...this.getDefaults(),
        ...stored,
        blockedCommands,
        hooks: normalizeHooks(stored.hooks),
        enableUserHooks: typeof stored.enableUserHooks === 'boolean'
          ? stored.enableUserHooks
          : true,
        model: migrateModel(typeof stored.model === 'string' ? stored.model : ''),
      } as StoredSettings;
    } catch (error) {
      console.error('[ObsidianCode] Failed to load settings:', error);
      return this.getDefaults();
    }
  }

  /** Save settings to .claude/settings.json. */
  async save(settings: StoredSettings): Promise<void> {
    try {
      const content = JSON.stringify(settings, null, 2);
      await this.adapter.write(SETTINGS_PATH, content);
    } catch (error) {
      console.error('[ObsidianCode] Failed to save settings:', error);
      throw error;
    }
  }

  /** Check if settings file exists. */
  async exists(): Promise<boolean> {
    return this.adapter.exists(SETTINGS_PATH);
  }

  /** Get default settings (excluding state fields). */
  private getDefaults(): StoredSettings {
    const {
      slashCommands: _,
      lastEnvHash: __,
      lastClaudeModel: ___,
      lastCustomModel: ____,
      ...defaults
    } = DEFAULT_SETTINGS;
    return defaults;
  }
}
