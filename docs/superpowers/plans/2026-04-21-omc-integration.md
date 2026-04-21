# obsidian-code v1.4.26 OMC Integration & Hooks Extension — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full Claude Code hooks schema support and OMC integration (skills, HUD, inline meta, MCP auto-import, CLI bridge) to obsidian-code v1.4.26.

**Architecture:** Hooks Extension wires user-defined shell commands into the existing SDK hook pipeline via a command adapter. OMC Integration reads `~/.claude/plugins/` via filesystem (desktop-only) and surfaces skills as slash commands, renders a live HUD strip, and optionally bridges to the OMC CLI for advanced features.

**Tech Stack:** TypeScript, Obsidian API (`Platform`, `FileSystemAdapter`), `@anthropic-ai/claude-agent-sdk`, Node.js `child_process` (desktop only), Jest

**Spec:** `docs/superpowers/specs/2026-04-21-omc-integration-design.md`

**Note:** All test imports use the `@/` alias (e.g. `import { X } from '@/core/types/hooks'`), matching project convention verified in `tests/unit/core/storage/storage.test.ts`.

**Commands:**
```bash
npm run typecheck   # type check
npm run lint        # lint
npm run build       # production build
npm run test        # all tests
npm run test -- --selectProjects unit   # unit only
```

**Scope Notes:**
- MVP for v1.4.26. The following spec items are **deferred** (not in this plan):
  - MCP import opt-in **modal** (Task 14 logs candidates only; modal ships in v1.4.27)
  - Hooks config **hash-change warning modal** (deferred security hardening)
  - HUD `ralph` / `todos` / `agents` / `ctx%` fields beyond `skill` (skeleton only; full field set in follow-up)
- Task 12 renders the meta badge on the `usage` chunk per the existing StreamController emission pattern. If the executor finds a `result`-style terminal chunk better matches "after stream completes," swap the case label while keeping the same MessageMetaRenderer call.

---

## Chunk 1: Foundation — Types, Model Filter, Settings Schema

**Files:**
- Create: `src/core/types/hooks.ts`
- Modify: `src/core/types/models.ts` (line 59 — DEFAULT_CLAUDE_MODELS)
- Modify: `src/core/types/settings.ts` (line 155 — DEFAULT_SETTINGS, ObsidianCodeSettings interface)
- Test: `tests/unit/core/types/hooks.test.ts`
- Test: `tests/unit/core/types/models.test.ts`

### Task 1: Create hook type definitions

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/core/types/hooks.test.ts
import type { HooksConfig, HookCommandSpec } from '@/core/types/hooks';

describe('hooks types', () => {
  it('HooksConfig accepts all valid events', () => {
    const cfg: HooksConfig = {
      SessionStart: [{ matcher: 'resume', hooks: [{ type: 'command', command: 'echo hi' }] }],
      PreToolUse: [{ hooks: [{ type: 'command', command: 'echo', timeout: 5000 }] }],
    };
    expect(cfg.SessionStart).toHaveLength(1);
    expect(cfg.PreToolUse?.[0].hooks[0].timeout).toBe(5000);
  });

  it('HookCommandSpec defaults timeout to undefined (consumer applies default)', () => {
    const spec: HookCommandSpec = { type: 'command', command: 'test' };
    expect(spec.timeout).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --selectProjects unit --testPathPattern hooks.test
```
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/core/types/hooks.ts`**

```typescript
export type HookEvent =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'SubagentStop'
  | 'Notification'
  | 'PreCompact';

export const HOOK_EVENTS: HookEvent[] = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'Stop', 'SubagentStop', 'Notification', 'PreCompact',
];

export interface HookCommandSpec {
  type: 'command';
  command: string;
  timeout?: number;
}

export interface HookMatcher {
  matcher?: string;
  hooks: HookCommandSpec[];
}

export type HooksConfig = Partial<Record<HookEvent, HookMatcher[]>>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- --selectProjects unit --testPathPattern hooks.test
```

- [ ] **Step 5: Commit**

```bash
git add src/core/types/hooks.ts tests/unit/core/types/hooks.test.ts
git commit -m "feat: add HooksConfig type definitions"
```

---

### Task 2: Filter models to Claude 4.6+

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/core/types/models.test.ts
import { DEFAULT_CLAUDE_MODELS } from '@/core/types/models';

describe('DEFAULT_CLAUDE_MODELS', () => {
  it('excludes models and aliases below 4.6', () => {
    const ids = DEFAULT_CLAUDE_MODELS.map(m => m.value);
    expect(ids).not.toContain('claude-haiku-4-5');
    expect(ids).not.toContain('claude-sonnet-4-5');
    expect(ids).not.toContain('claude-opus-4-5');
    expect(ids).not.toContain('claude-opus-4-6');
  });

  it('includes claude-sonnet-4-6 and claude-opus-4-7', () => {
    const ids = DEFAULT_CLAUDE_MODELS.map(m => m.value);
    expect(ids).toContain('claude-sonnet-4-6');
    expect(ids).toContain('claude-opus-4-7');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test -- --selectProjects unit --testPathPattern models.test
```

- [ ] **Step 3: Update `src/core/types/models.ts`**

Remove these entries from `DEFAULT_CLAUDE_MODELS` (lines ~64-68):
- `{ value: 'claude-haiku-4-5', ... }`
- `{ value: 'claude-sonnet-4-5', ... }`
- `{ value: 'claude-opus-4-5', ... }`
- `{ value: 'claude-opus-4-6', ... }`

Remove matching keys from `DEFAULT_THINKING_BUDGETS` (lines ~94-101):
- `'claude-haiku-4-5'`, `'claude-sonnet-4-5'`, `'claude-opus-4-5'`, `'claude-opus-4-6'`

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- --selectProjects unit --testPathPattern models.test
```

- [ ] **Step 5: Commit**

```bash
git add src/core/types/models.ts tests/unit/core/types/models.test.ts
git commit -m "feat: restrict model selector to Claude 4.6+"
```

---

### Task 3: Add hooks + enableUserHooks to settings schema

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/core/storage/settings-hooks.test.ts
import { DEFAULT_SETTINGS } from '@/core/types';

describe('DEFAULT_SETTINGS hooks fields', () => {
  it('has empty hooks config by default', () => {
    expect(DEFAULT_SETTINGS.hooks).toEqual({});
  });

  it('has enableUserHooks true by default', () => {
    expect(DEFAULT_SETTINGS.enableUserHooks).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test -- --selectProjects unit --testPathPattern settings-hooks.test
```

- [ ] **Step 3: Update `src/core/types/settings.ts`**

Add to `ObsidianCodeSettings` interface:
```typescript
import type { HooksConfig } from './hooks';

// In ObsidianCodeSettings:
hooks: HooksConfig;
enableUserHooks: boolean;
```

Add to `DEFAULT_SETTINGS` (line ~155):
```typescript
hooks: {},
enableUserHooks: true,
```

Add model migration helper at bottom of file (exported, used by SettingsStorage):
```typescript
// CLI aliases ('sonnet', 'opus', 'haiku') and full model IDs below 4.6 all migrate to default
const ALLOWED_MODELS = new Set(DEFAULT_CLAUDE_MODELS.map(m => m.value));
const LEGACY_ALIASES = new Set(['sonnet', 'opus', 'haiku']);  // old CLI shorthand

export function migrateModel(saved: string): string {
  // Keep known good full IDs and legacy aliases that map to a current model
  if (ALLOWED_MODELS.has(saved)) return saved;
  if (LEGACY_ALIASES.has(saved)) return saved;  // preserve; plugin resolves alias at runtime
  return 'claude-sonnet-4-6';
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- --selectProjects unit --testPathPattern settings-hooks.test
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/core/types/settings.ts tests/unit/core/storage/settings-hooks.test.ts
git commit -m "feat: add hooks config and enableUserHooks to settings schema"
```

---

## Chunk 2: Hooks Execution — Adapter, Storage, Service

**Files:**
- Create: `src/core/hooks/commandHookAdapter.ts`
- Modify: `src/core/storage/SettingsStorage.ts` (add normalizeHooks, migrateModel call)
- Modify: `src/core/agent/ObsidianCodeService.ts` (hooks merge at ~line 523)
- Test: `tests/unit/core/hooks/commandHookAdapter.test.ts`
- Test: `tests/unit/core/storage/settingsStorage-hooks.test.ts`

### Task 4: Command hook adapter

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/core/hooks/commandHookAdapter.test.ts
import { scrubSensitiveEnv, expandUserHooks } from '@/core/hooks/commandHookAdapter';
import type { HooksConfig } from '@/core/types/hooks';

describe('scrubSensitiveEnv', () => {
  it('strips _API_KEY, _TOKEN, _SECRET, _PASSWORD, _AUTH_TOKEN suffixes', () => {
    const env = {
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'sk-secret',
      MY_TOKEN: 'abc',
      AUTHOR: 'alice',
      HOME: '/home/user',
      GITHUB_AUTH_TOKEN: 'ghp_xxx',
      KEYBOARD_LAYOUT: 'us',
    };
    const result = scrubSensitiveEnv(env);
    expect(result.PATH).toBe('/usr/bin');
    expect(result.AUTHOR).toBe('alice');
    expect(result.HOME).toBe('/home/user');
    expect(result.KEYBOARD_LAYOUT).toBe('us');
    expect(result.ANTHROPIC_API_KEY).toBeUndefined();
    expect(result.MY_TOKEN).toBeUndefined();
    expect(result.GITHUB_AUTH_TOKEN).toBeUndefined();
  });
});

describe('expandUserHooks', () => {
  it('returns empty object for empty config', () => {
    expect(expandUserHooks({}, '/vault')).toEqual({});
  });

  it('maps each event to array of async functions', () => {
    const cfg: HooksConfig = {
      Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }],
    };
    const result = expandUserHooks(cfg, '/vault');
    expect(Array.isArray(result.Stop)).toBe(true);
    expect(typeof result.Stop?.[0]).toBe('function');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test -- --selectProjects unit --testPathPattern commandHookAdapter.test
```

- [ ] **Step 3: Create `src/core/hooks/commandHookAdapter.ts`**

```typescript
import { Platform, FileSystemAdapter } from 'obsidian';
import { spawn } from 'child_process';
import type { HooksConfig, HookEvent, HookCommandSpec } from '../types/hooks';
import { HOOK_EVENTS } from '../types/hooks';

const SENSITIVE_SUFFIX = /_(API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH_TOKEN)$/i;

export function scrubSensitiveEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([k]) => !SENSITIVE_SUFFIX.test(k))
  );
}

function extractToolName(input: unknown): string {
  return (input as any)?.tool_name ?? (input as any)?.toolName ?? '';
}

function execCommand(
  spec: HookCommandSpec,
  event: HookEvent,
  hookInput: unknown,
  vaultPath: string
): Promise<any> {
  return new Promise((resolve) => {
    const child = spawn(spec.command, {
      shell: true,
      timeout: Math.min(spec.timeout ?? 60_000, 300_000),
      cwd: vaultPath,
      env: {
        ...scrubSensitiveEnv(process.env),
        CLAUDE_HOOK_EVENT: event,
        CLAUDE_HOOK_TOOL: extractToolName(hookInput),
      },
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
    child.stdin?.write(JSON.stringify(hookInput ?? {}));
    child.stdin?.end();

    child.on('close', (code) => {
      if (code === 2) {
        return resolve({
          hookSpecificOutput: {
            hookEventName: event,
            permissionDecision: 'deny',
            permissionDecisionReason: stderr.trim() || 'Hook denied',
          },
        });
      }
      try {
        resolve(stdout.trim() ? JSON.parse(stdout) : {});
      } catch {
        resolve({});
      }
    });

    child.on('error', () => resolve({}));
  });
}

export function createCommandHookExecutor(
  spec: HookCommandSpec,
  event: HookEvent,
  vaultPath: string
) {
  return async (hookInput: unknown) => {
    if (!Platform.isDesktop) return {};
    return execCommand(spec, event, hookInput, vaultPath);
  };
}

export function expandUserHooks(
  config: HooksConfig,
  vaultPath: string
): Partial<Record<HookEvent, ((input: unknown) => Promise<any>)[]>> {
  if (!Platform.isDesktop) return {};
  const result: Partial<Record<HookEvent, ((input: unknown) => Promise<any>)[]>> = {};

  for (const event of HOOK_EVENTS) {
    const matchers = config[event];
    if (!matchers?.length) continue;
    const fns: ((input: unknown) => Promise<any>)[] = [];
    for (const matcher of matchers) {
      for (const hookSpec of matcher.hooks) {
        fns.push(createCommandHookExecutor(hookSpec, event, vaultPath));
      }
    }
    if (fns.length) result[event] = fns;
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test -- --selectProjects unit --testPathPattern commandHookAdapter.test
```

- [ ] **Step 5: Commit**

```bash
git add src/core/hooks/commandHookAdapter.ts tests/unit/core/hooks/commandHookAdapter.test.ts
git commit -m "feat: add command hook adapter for user-defined shell hooks"
```

---

### Task 5: normalizeHooks in SettingsStorage

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/core/storage/settingsStorage-hooks.test.ts
import { normalizeHooks } from '@/core/storage/SettingsStorage';

describe('normalizeHooks', () => {
  it('returns empty object for null/undefined', () => {
    expect(normalizeHooks(null)).toEqual({});
    expect(normalizeHooks(undefined)).toEqual({});
  });

  it('drops unknown events', () => {
    const result = normalizeHooks({ UnknownEvent: [] });
    expect((result as any).UnknownEvent).toBeUndefined();
  });

  it('clamps timeout to [1000, 300000]', () => {
    const result = normalizeHooks({
      Stop: [{ hooks: [{ type: 'command', command: 'x', timeout: 0 }] }],
    });
    expect(result.Stop?.[0].hooks[0].timeout).toBe(1_000);
  });

  it('drops matchers with invalid regex', () => {
    const result = normalizeHooks({
      PreToolUse: [{ matcher: '[invalid', hooks: [{ type: 'command', command: 'x' }] }],
    });
    expect(result.PreToolUse).toHaveLength(0);
  });

  it('keeps valid config intact', () => {
    const result = normalizeHooks({
      SessionStart: [{ matcher: 'resume', hooks: [{ type: 'command', command: 'echo hi' }] }],
    });
    expect(result.SessionStart?.[0].matcher).toBe('resume');
    expect(result.SessionStart?.[0].hooks[0].command).toBe('echo hi');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test -- --selectProjects unit --testPathPattern settingsStorage-hooks.test
```

- [ ] **Step 3: Add `normalizeHooks` to `src/core/storage/SettingsStorage.ts`**

Add import at top:
```typescript
import type { HooksConfig } from '../types/hooks';
import { HOOK_EVENTS } from '../types/hooks';
import { migrateModel } from '../types/settings';
```

Add exported function after existing normalize helpers:
```typescript
export function normalizeHooks(value: unknown): HooksConfig {
  if (!value || typeof value !== 'object') return {};
  const out: HooksConfig = {};
  for (const event of HOOK_EVENTS) {
    const matchers = (value as any)[event];
    if (!Array.isArray(matchers)) continue;
    out[event] = matchers
      .filter((m: any) => {
        if (!m?.hooks || !Array.isArray(m.hooks)) return false;
        if (m.matcher) {
          try { new RegExp(m.matcher); } catch { return false; }
        }
        return true;
      })
      .map((m: any) => ({
        matcher: typeof m.matcher === 'string' ? m.matcher : undefined,
        hooks: m.hooks
          .filter((h: any) => h?.type === 'command' && typeof h.command === 'string')
          .map((h: any) => ({
            type: 'command' as const,
            command: h.command,
            timeout: typeof h.timeout === 'number'
              ? Math.max(1_000, Math.min(h.timeout, 300_000))
              : undefined,
          })),
      }));
  }
  return out;
}
```

In `SettingsStorage.load()` return block, add the new fields:
```typescript
return {
  ...this.getDefaults(),
  ...stored,
  blockedCommands,
  hooks: normalizeHooks(stored.hooks),
  enableUserHooks: typeof stored.enableUserHooks === 'boolean'
    ? stored.enableUserHooks
    : true,
  model: migrateModel(stored.model ?? ''),
};
```

- [ ] **Step 4: Run tests**

```bash
npm run test -- --selectProjects unit --testPathPattern settingsStorage
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/core/storage/SettingsStorage.ts tests/unit/core/storage/settingsStorage-hooks.test.ts
git commit -m "feat: add normalizeHooks to SettingsStorage with model migration"
```

---

### Task 6: Wire user hooks into ObsidianCodeService

- [ ] **Step 1: Add Platform import to `src/core/agent/ObsidianCodeService.ts`**

At top of file, add (if not already present):
```typescript
import { Platform } from 'obsidian';
```

- [ ] **Step 2: Add commandHookAdapter import**

```typescript
import { expandUserHooks } from '../hooks/commandHookAdapter';
```

- [ ] **Step 3: Replace `options.hooks` block**

Find the exact block (lines ~523-526):
```typescript
    options.hooks = {
      PreToolUse: [blocklistHook, vaultRestrictionHook, fileHashPreHook],
      PostToolUse: [fileHashPostHook],
    };
```

Replace with:
```typescript
    const userHooks = (
      this.plugin.settings.enableUserHooks &&
      !queryOptions?.planMode &&
      Platform.isDesktop
    ) ? expandUserHooks(this.plugin.settings.hooks, this.vaultPath)
      : {};

    options.hooks = {
      PreToolUse: [
        blocklistHook, vaultRestrictionHook, fileHashPreHook,
        ...(userHooks.PreToolUse ?? []),
      ],
      PostToolUse: [
        fileHashPostHook,
        ...(userHooks.PostToolUse ?? []),
      ],
      SessionStart:     userHooks.SessionStart     ?? [],
      UserPromptSubmit: userHooks.UserPromptSubmit ?? [],
      Stop:             userHooks.Stop             ?? [],
      SubagentStop:     userHooks.SubagentStop     ?? [],
      Notification:     userHooks.Notification     ?? [],
      PreCompact:       userHooks.PreCompact       ?? [],
    };
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Fix any type errors before continuing.

- [ ] **Step 5: Build**

```bash
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/core/agent/ObsidianCodeService.ts
git commit -m "feat: merge user-defined hooks into SDK hook pipeline"
```

---

## Chunk 3: OMC Core — Detector, Skills, MCP

**Files:**
- Create: `src/core/omc/OMCDetector.ts`
- Create: `src/core/omc/OMCSkillsLoader.ts`
- Create: `src/core/omc/OMCMCPImporter.ts`
- Test: `tests/unit/core/omc/OMCDetector.test.ts`
- Test: `tests/unit/core/omc/OMCSkillsLoader.test.ts`

### Task 7: OMC Detector

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/core/omc/OMCDetector.test.ts
// Note: mock Platform before importing OMCDetector
jest.mock('obsidian', () => ({ Platform: { isDesktop: true } }));

import { OMCDetector } from '@/core/omc/OMCDetector';

describe('OMCDetector', () => {
  it('returns null when plugin dir does not exist', async () => {
    const detector = new OMCDetector('/nonexistent/path');
    const result = await detector.detect();
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test -- --selectProjects unit --testPathPattern OMCDetector.test
```

- [ ] **Step 3: Create `src/core/omc/OMCDetector.ts`**

```typescript
import { Platform } from 'obsidian';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface OMCInstall {
  version: string;
  pluginRoot: string;
  cliPath: string | null;
  configPath: string;
}

export class OMCDetector {
  private claudeDir: string;

  constructor(claudeDir?: string) {
    this.claudeDir = claudeDir ?? path.join(os.homedir(), '.claude');
  }

  static async detect(): Promise<OMCInstall | null> {
    return new OMCDetector().detect();
  }

  async detect(): Promise<OMCInstall | null> {
    if (!Platform.isDesktop) return null;

    try {
      const pluginBase = path.join(
        this.claudeDir, 'plugins', 'cache', 'omc', 'oh-my-claudecode'
      );
      if (!fs.existsSync(pluginBase)) return null;

      const versions = fs.readdirSync(pluginBase)
        .filter(v => /^\d/.test(v))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      if (!versions.length) return null;

      const version = versions[versions.length - 1];
      const pluginRoot = path.join(pluginBase, version);
      const configPath = path.join(this.claudeDir, '.omc-config.json');
      const cliPath = await this.findCli();

      return { version, pluginRoot, cliPath, configPath };
    } catch {
      return null;
    }
  }

  private findCli(): Promise<string | null> {
    return new Promise((resolve) => {
      const { spawn } = require('child_process');
      const child = spawn('omc', ['--version'], { shell: true, timeout: 3000 });
      child.on('close', (code: number) => resolve(code === 0 ? 'omc' : null));
      child.on('error', () => resolve(null));
    });
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test -- --selectProjects unit --testPathPattern OMCDetector.test
```

- [ ] **Step 5: Commit**

```bash
git add src/core/omc/OMCDetector.ts tests/unit/core/omc/OMCDetector.test.ts
git commit -m "feat: add OMCDetector for installation discovery"
```

---

### Task 8: OMC Skills Loader

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/core/omc/OMCSkillsLoader.test.ts
jest.mock('obsidian', () => ({ Platform: { isDesktop: true } }));

import { OMCSkillsLoader, parseSkillMeta } from '@/core/omc/OMCSkillsLoader';

describe('parseSkillMeta', () => {
  it('extracts name and description from SKILL.md frontmatter', () => {
    const content = `---\nname: my-skill\ndescription: Does something useful\n---\n\n# Content`;
    const result = parseSkillMeta('my-skill', content);
    expect(result.name).toBe('my-skill');
    expect(result.description).toBe('Does something useful');
  });

  it('falls back to directory name when frontmatter missing', () => {
    const result = parseSkillMeta('fallback-name', '# No frontmatter');
    expect(result.name).toBe('fallback-name');
  });
});

describe('OMCSkillsLoader collision handling', () => {
  it('prefixes with omc: when name collides', () => {
    const loader = new OMCSkillsLoader('/plugin-root');
    const name = loader.resolveCommandName('plan', new Set(['plan']));
    expect(name).toBe('omc:plan');
  });

  it('keeps original name when no collision', () => {
    const loader = new OMCSkillsLoader('/plugin-root');
    const name = loader.resolveCommandName('executor', new Set());
    expect(name).toBe('executor');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test -- --selectProjects unit --testPathPattern OMCSkillsLoader.test
```

- [ ] **Step 3: Create `src/core/omc/OMCSkillsLoader.ts`**

```typescript
import { Platform } from 'obsidian';
import * as path from 'path';
import * as fs from 'fs';

export interface OMCSkill {
  name: string;
  commandName: string;  // may be prefixed with 'omc:'
  description: string;
  content: string;
}

export function parseSkillMeta(dirName: string, content: string): { name: string; description: string } {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return { name: dirName, description: '' };

  const fm = fmMatch[1];
  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? dirName;
  const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? '';
  return { name, description };
}

export class OMCSkillsLoader {
  private pluginRoot: string;
  private skills: OMCSkill[] = [];

  constructor(pluginRoot: string) {
    this.pluginRoot = pluginRoot;
  }

  resolveCommandName(name: string, existingNames: Set<string>): string {
    return existingNames.has(name) ? `omc:${name}` : name;
  }

  load(existingCommandNames: Set<string> = new Set()): OMCSkill[] {
    if (!Platform.isDesktop) return [];

    const skillsDir = path.join(this.pluginRoot, 'skills');
    if (!fs.existsSync(skillsDir)) return [];

    this.skills = [];
    try {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillMd = path.join(skillsDir, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillMd)) continue;
        const content = fs.readFileSync(skillMd, 'utf-8');
        const { name, description } = parseSkillMeta(entry.name, content);
        const commandName = this.resolveCommandName(name, existingCommandNames);
        this.skills.push({ name, commandName, description, content });
      }
    } catch {
      // fail silently — OMC missing is not an error
    }
    return this.skills;
  }

  unload(): void {
    this.skills = [];
  }

  getSkillContent(commandName: string): string | null {
    return this.skills.find(s => s.commandName === commandName)?.content ?? null;
  }

  getAll(): OMCSkill[] {
    return [...this.skills];
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test -- --selectProjects unit --testPathPattern OMCSkillsLoader.test
```

- [ ] **Step 5: Commit**

```bash
git add src/core/omc/OMCSkillsLoader.ts tests/unit/core/omc/OMCSkillsLoader.test.ts
git commit -m "feat: add OMCSkillsLoader for skill discovery and slash command registration"
```

---

### Task 9: OMC MCP Importer

- [ ] **Step 1: Create `src/core/omc/OMCMCPImporter.ts`**

```typescript
import { Platform } from 'obsidian';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface MCPCandidateServer {
  name: string;
  config: Record<string, unknown>;
}

export class OMCMCPImporter {
  private claudeDir: string;

  constructor(claudeDir?: string) {
    this.claudeDir = claudeDir ?? path.join(os.homedir(), '.claude');
  }

  /**
   * Read candidate MCP servers from ~/.claude/settings.json
   * that aren't already registered in the plugin's McpServerManager.
   * alreadyRegistered: set of server names from plugin.mcpService.getManager().getServers().map(s => s.name)
   */
  getCandidates(alreadyRegistered: Set<string>): MCPCandidateServer[] {
    if (!Platform.isDesktop) return [];

    try {
      const settingsPath = path.join(this.claudeDir, 'settings.json');
      if (!fs.existsSync(settingsPath)) return [];

      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const servers = settings.mcpServers ?? {};

      return Object.entries(servers)
        .filter(([name]) => !alreadyRegistered.has(name))
        .filter(([, cfg]: [string, any]) =>
          cfg.command || cfg.url || cfg.transport === 'http'
        )
        .map(([name, config]) => ({ name, config: config as Record<string, unknown> }));
    } catch {
      return [];
    }
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/core/omc/OMCMCPImporter.ts
git commit -m "feat: add OMCMCPImporter to read candidate MCP servers from ~/.claude"
```

---

## Chunk 4: OMC UI — HUD Provider, HUD View, Message Meta

**Files:**
- Create: `src/core/omc/OMCHUDProvider.ts`
- Create: `src/ui/components/OMCHUDView.ts`
- Create: `src/ui/renderers/MessageMetaRenderer.ts`
- Create: `src/style/components/omc-hud.css`
- Modify: `src/style/index.css` (register CSS — add after `plan-banner.css` line)
- Test: `tests/unit/core/omc/OMCHUDProvider.test.ts`

### Task 10: OMC HUD Provider

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/core/omc/OMCHUDProvider.test.ts
jest.mock('obsidian', () => ({ Platform: { isDesktop: true } }));

import { OMCHUDProvider } from '@/core/omc/OMCHUDProvider';

describe('OMCHUDProvider', () => {
  it('returns empty HUDData when state dir does not exist', async () => {
    const provider = new OMCHUDProvider({ pluginRoot: '/nonexistent', cliPath: null }, '/nonexistent-vault');
    const data = await provider.readStateFiles();
    expect(data).toEqual({ skill: null, ralph: null, todos: null });
  });

  it('computes context percentage from usage', () => {
    const pct = OMCHUDProvider.contextPercent(6700, 100000);
    expect(pct).toBe(7);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test -- --selectProjects unit --testPathPattern OMCHUDProvider.test
```

- [ ] **Step 3: Create `src/core/omc/OMCHUDProvider.ts`**

```typescript
import { Platform } from 'obsidian';
import * as fs from 'fs';
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

  constructor(install: Pick<OMCInstall, 'pluginRoot' | 'cliPath'>, vaultPath: string) {
    this.install = install;
    this.vaultPath = vaultPath;
  }

  static contextPercent(inputTokens: number, contextWindow: number): number {
    if (!contextWindow) return 0;
    return Math.round((inputTokens / contextWindow) * 100);
  }

  /**
   * Reads OMC state from the vault's `.omc/state/` directory.
   * We use vaultPath (not process.cwd()) because on desktop Obsidian,
   * process.cwd() typically points to the Obsidian binary, not the user's workspace.
   */
  async readStateFiles(): Promise<Pick<HUDData, 'skill' | 'ralph' | 'todos'>> {
    const stateDir = path.join(this.vaultPath, '.omc', 'state');
    const result: Pick<HUDData, 'skill' | 'ralph' | 'todos'> = {
      skill: null, ralph: null, todos: null,
    };
    if (!fs.existsSync(stateDir)) return result;
    try {
      const activeSkillPath = path.join(stateDir, 'active-skill.json');
      if (fs.existsSync(activeSkillPath)) {
        const s = JSON.parse(fs.readFileSync(activeSkillPath, 'utf-8'));
        result.skill = s.name ?? null;
      }
    } catch { /* ignore */ }
    return result;
  }

  on(listener: HUDListener): void { this.listeners.push(listener); }
  off(listener: HUDListener): void { this.listeners = this.listeners.filter(l => l !== listener); }

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
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.listeners = [];
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test -- --selectProjects unit --testPathPattern OMCHUDProvider.test
```

- [ ] **Step 5: Commit**

```bash
git add src/core/omc/OMCHUDProvider.ts tests/unit/core/omc/OMCHUDProvider.test.ts
git commit -m "feat: add OMCHUDProvider with polling and exponential backoff"
```

---

### Task 11: OMC HUD View component

- [ ] **Step 1: Create `src/ui/components/OMCHUDView.ts`**

```typescript
import { Platform } from 'obsidian';
import type { HUDData } from '../../core/omc/OMCHUDProvider';

export class OMCHUDView {
  private el: HTMLElement;
  private visible = false;

  /** container must be the inner chat container (containerEl.children[1]), not the root */
  constructor(container: HTMLElement) {
    this.el = container.createDiv({ cls: 'oc-omc-hud' });
    this.el.style.display = 'none';
  }

  show(): void {
    if (!Platform.isDesktop) return;
    this.el.style.display = '';
    this.visible = true;
  }

  update(data: HUDData): void {
    if (!this.visible) return;
    const parts: string[] = ['[OMC]'];
    if (data.skill) parts.push(`skill:${data.skill}`);
    if (data.contextPercent !== undefined) {
      const pct = data.contextPercent;
      const cls = pct >= 85 ? 'oc-hud-critical' : pct >= 70 ? 'oc-hud-warning' : '';
      parts.push(`<span class="${cls}">ctx:${pct}%</span>`);
    }
    if (data.agents !== undefined && data.agents > 0) parts.push(`agents:${data.agents}`);
    if (data.ralph) parts.push(`ralph:${data.ralph.current}/${data.ralph.max}`);
    if (data.todos) parts.push(`todos:${data.todos.done}/${data.todos.total}`);
    this.el.innerHTML = parts.join(' │ ');
  }

  destroy(): void { this.el.remove(); }
}
```

- [ ] **Step 2: Create `src/style/components/omc-hud.css`**

```css
.oc-omc-hud {
  position: sticky;
  bottom: 0;
  padding: 2px 8px;
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  background: var(--background-primary);
  border-top: 1px solid var(--background-modifier-border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  z-index: 10;
}
.oc-hud-warning { color: var(--color-yellow); }
.oc-hud-critical { color: var(--color-red); }

/* Message meta badge */
.oc-message-meta {
  margin-top: 4px;
  font-size: var(--font-ui-smaller);
  color: var(--text-faint);
}
.oc-message-meta-toggle {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-faint);
  padding: 0 2px;
}
.oc-message-meta-detail { padding-left: 4px; }
```

- [ ] **Step 3: Register CSS in `src/style/index.css`**

Find the line `@import './components/plan-banner.css';` and add after it:
```css
@import './components/omc-hud.css';
```

- [ ] **Step 4: Typecheck + build**

```bash
npm run typecheck && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/OMCHUDView.ts src/style/components/omc-hud.css src/style/index.css
git commit -m "feat: add OMCHUDView sticky status bar component"
```

---

### Task 12: Message Meta Renderer

- [ ] **Step 1: Create `src/ui/renderers/MessageMetaRenderer.ts`**

```typescript
export interface MessageMeta {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  elapsedMs: number;
}

export class MessageMetaRenderer {
  /**
   * Appends a collapsible meta badge to the given message wrapper element.
   * Call this from StreamController after the 'usage' or 'done' chunk is received,
   * passing the assistant message's root DOM element.
   */
  static render(messageWrapperEl: HTMLElement, meta: MessageMeta): void {
    const wrapper = messageWrapperEl.createDiv({ cls: 'oc-message-meta' });
    const toggle = wrapper.createEl('button', {
      cls: 'oc-message-meta-toggle',
      text: '▸',
    });
    const detail = wrapper.createDiv({ cls: 'oc-message-meta-detail' });
    detail.style.display = 'none';

    const parts = [
      meta.model,
      `↑${meta.inputTokens.toLocaleString()} ↓${meta.outputTokens.toLocaleString()} tok`,
    ];
    if (meta.cacheReadTokens) parts.push(`📦 ${meta.cacheReadTokens.toLocaleString()}`);
    parts.push(`${(meta.elapsedMs / 1000).toFixed(1)}s`);
    detail.textContent = parts.join(' │ ');

    toggle.addEventListener('click', () => {
      const collapsed = detail.style.display === 'none';
      detail.style.display = collapsed ? '' : 'none';
      toggle.textContent = collapsed ? '▾' : '▸';
    });
  }
}
```

- [ ] **Step 2: Integrate into StreamController**

In `src/features/chat/controllers/StreamController.ts`, find where `chunk.type === 'usage'` is handled (currently stores `state.usage = chunk.usage`). Add MessageMetaRenderer call there:

```typescript
import { MessageMetaRenderer } from '../../../ui/renderers/MessageMetaRenderer';

// Where 'usage' chunk is processed, after state.usage = chunk.usage:
case 'usage': {
  state.usage = chunk.usage;
  // Render meta badge on current message element
  const msgEl = this.getCurrentMessageEl();  // see note below
  if (msgEl) {
    MessageMetaRenderer.render(msgEl, {
      model: this.currentModel ?? '',
      inputTokens: chunk.usage.inputTokens ?? 0,
      outputTokens: 0,  // output tokens tracked separately if available
      cacheReadTokens: chunk.usage.cacheReadInputTokens,
      elapsedMs: Date.now() - this.streamStartTime,
    });
  }
  break;
}
```

**Note for executor:** `getCurrentMessageEl()` and `streamStartTime` need to be tracked in StreamController state. Check how `state.currentContentEl` is managed (similar to how `planBanner` tracks state) and pass the wrapping message div. Record `streamStartTime = Date.now()` when the stream starts.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/ui/renderers/MessageMetaRenderer.ts src/features/chat/controllers/StreamController.ts
git commit -m "feat: add MessageMetaRenderer for per-message token/model badge"
```

---

## Chunk 5: CLI Bridge + Wiring + Settings UI

**Files:**
- Create: `src/core/omc/CLIBridge.ts`
- Modify: `src/features/chat/ObsidianCodeView.ts` (private fields + mount + lifecycle)
- Modify: `src/features/settings/ObsidianCodeSettings.ts` (enableUserHooks toggle)

### Task 13: CLI Bridge

- [ ] **Step 1: Create `src/core/omc/CLIBridge.ts`**

```typescript
import { Platform } from 'obsidian';
import { spawn, ChildProcess } from 'child_process';

export class CLIBridge {
  private active: ChildProcess | null = null;

  get isRunning(): boolean { return this.active !== null; }

  run(
    command: string,
    vaultPath: string,
    onChunk: (text: string) => void,
    onDone: () => void,
    onError: (err: string) => void
  ): boolean {
    if (!Platform.isDesktop) { onError('CLI bridge requires desktop'); return false; }
    if (this.active) { onError('A bridge process is already running'); return false; }

    this.active = spawn(command, { shell: true, cwd: vaultPath });
    this.active.stdout?.on('data', (d: Buffer) => onChunk(d.toString()));
    this.active.stderr?.on('data', (d: Buffer) => onChunk(d.toString()));
    this.active.on('close', () => { this.active = null; onDone(); });
    this.active.on('error', (e) => { this.active = null; onError(e.message); });
    return true;
  }

  cancel(): void {
    if (!this.active) return;
    this.active.kill('SIGTERM');
    setTimeout(() => { this.active?.kill('SIGKILL'); }, 2000);
    this.active = null;
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/core/omc/CLIBridge.ts
git commit -m "feat: add CLIBridge for advanced OMC subprocess features"
```

---

### Task 14: Wire OMC into ObsidianCodeView

**Important:** Follow the existing private field pattern (lines 54-88). Store all OMC components as nullable private fields. Mount HUD to inner `container` (line 114: `this.containerEl.children[1]`), not `this.containerEl`.

- [ ] **Step 1: Add private fields to `src/features/chat/ObsidianCodeView.ts`**

In the private fields section (after line ~88, with other nullable fields):
```typescript
// OMC integration (desktop-only, null when OMC not installed)
private omcHUDView: OMCHUDView | null = null;
private omcHUDProvider: OMCHUDProvider | null = null;
private omcSkillsLoader: OMCSkillsLoader | null = null;
private omcCLIBridge: CLIBridge | null = null;
```

Add imports at top:
```typescript
import { OMCDetector } from '../../core/omc/OMCDetector';
import { OMCSkillsLoader } from '../../core/omc/OMCSkillsLoader';
import { OMCHUDProvider } from '../../core/omc/OMCHUDProvider';
import { OMCHUDView } from '../../ui/components/OMCHUDView';
import { OMCMCPImporter } from '../../core/omc/OMCMCPImporter';
import { CLIBridge } from '../../core/omc/CLIBridge';
import { getVaultPath } from '../../utils/path';
```

- [ ] **Step 2: Initialize OMC in `onOpen()` (after existing component setup, inside the inner `container` block)**

```typescript
// OMC integration — after container is set up (line ~127, after planBanner.mount)
try {
  const omcInstall = await OMCDetector.detect();
  if (omcInstall) {
    // Skills → slash commands
    const existingCmds = new Set(
      this.slashCommandManager?.getCommands().map((c: any) => c.name) ?? []
    );
    this.omcSkillsLoader = new OMCSkillsLoader(omcInstall.pluginRoot);
    const skills = this.omcSkillsLoader.load(existingCmds);
    // Register OMC skills into slash command dropdown
    this.slashCommandDropdown?.addExtraCommands(
      skills.map(s => ({ name: s.commandName, description: s.description, omcSkill: true }))
    );

    // HUD — mount to inner container (same as planBanner)
    this.omcHUDView = new OMCHUDView(container);
    this.omcHUDView.show();
    const vaultPath = getVaultPath(this.app);
    if (!vaultPath) throw new Error('Vault path unavailable');
    this.omcHUDProvider = new OMCHUDProvider(omcInstall, vaultPath);
    this.omcHUDProvider.on((data) => this.omcHUDView?.update(data));
    this.omcHUDProvider.start();

    // CLI Bridge
    this.omcCLIBridge = new CLIBridge();

    // MCP import — get registered names from McpServerManager
    const registered = new Set(
      this.plugin.mcpService.getManager().getServers().map((s: any) => s.name)
    );
    const candidates = new OMCMCPImporter().getCandidates(registered);
    if (candidates.length > 0) {
      // TODO: show opt-in modal (OMCMCPImportModal — implement separately)
      console.log('[OMC] MCP candidates available:', candidates.map(c => c.name));
    }
  }
} catch (err) {
  console.warn('[OMC] Integration init failed (non-fatal):', err);
}
```

- [ ] **Step 3: Add cleanup in `onClose()`**

```typescript
// In onClose(), after existing controller cleanup:
this.omcHUDProvider?.stop();
this.omcHUDProvider = null;
this.omcSkillsLoader?.unload();
this.omcSkillsLoader = null;
this.omcHUDView?.destroy();
this.omcHUDView = null;
this.omcCLIBridge?.cancel();
this.omcCLIBridge = null;
```

- [ ] **Step 4: Add plugin unload safety in `main.ts`**

In `ObsidianCodePlugin.onunload()` (or via `this.registerEvent`), ensure active views are closed:
```typescript
// Already handled by Obsidian's view lifecycle — onClose() fires on unload.
// Verify by checking plugin.onunload() calls this.app.workspace.detachLeavesOfType(VIEW_TYPE_OBSIDIAN_CODE)
```

If not present, add to plugin `onunload()`:
```typescript
this.app.workspace.detachLeavesOfType(VIEW_TYPE_OBSIDIAN_CODE);
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Fix any type errors (especially around `slashCommandDropdown.addExtraCommands` — check SlashCommandDropdown API, adapt method name to what exists).

- [ ] **Step 6: Commit**

```bash
git add src/features/chat/ObsidianCodeView.ts
git commit -m "feat: wire OMC HUD, skills, MCP importer into chat view with lifecycle cleanup"
```

---

### Task 15: Settings UI additions

- [ ] **Step 1: Update `src/features/settings/ObsidianCodeSettings.ts`**

Find the security/permissions section and add after it:

```typescript
// Hooks section
containerEl.createEl('h3', { text: 'Hooks' });

new Setting(containerEl)
  .setName('Enable user-defined hooks')
  .setDesc('Allow .claude/settings.json hooks to execute shell commands. Desktop only. Disable to use built-in hooks only.')
  .addToggle(t => t
    .setValue(this.plugin.settings.enableUserHooks)
    .onChange(async (v) => {
      this.plugin.settings.enableUserHooks = v;
      await this.plugin.saveSettings();
    }));
```

- [ ] **Step 2: Typecheck + build**

```bash
npm run typecheck && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/features/settings/ObsidianCodeSettings.ts
git commit -m "feat: add enableUserHooks toggle to settings UI"
```

---

### Task 16: Final validation

- [ ] **Step 1: Run full test suite**

```bash
npm run test
```

Expected: all tests pass.

- [ ] **Step 2: Full typecheck + lint**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 3: Production build**

```bash
npm run build
```

- [ ] **Step 4: Manual smoke test checklist**

1. Open Obsidian with plugin active
2. Model selector shows only Sonnet 4.6 and Opus 4.7 ✓
3. Add hook to `.claude/settings.json` → verify fires on Stop ✓
4. OMC installed: `[OMC]` HUD strip appears at bottom of chat ✓
5. Type `/` in chat → OMC skills appear with `[OMC]` badge ✓
6. Send message → meta badge `▸` under response, click to expand ✓
7. Mobile: HUD hidden, hooks disabled, no errors ✓

- [ ] **Step 5: Bump version in manifest.json and package.json**

```bash
# Update "version" field to "1.4.26" in both files (manual or via npm version):
npm version 1.4.26 --no-git-tag-version
# Confirm manifest.json version was bumped too (obsidian plugin requires it):
grep '"version"' manifest.json package.json
git add manifest.json package.json versions.json
git commit -m "chore: bump version to 1.4.26"
```

- [ ] **Step 6: Tag release**

```bash
git tag v1.4.26
```

---

## File Map Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/core/types/hooks.ts` | Create | HookEvent types and HooksConfig |
| `src/core/types/models.ts` | Modify | Remove models below 4.6 |
| `src/core/types/settings.ts` | Modify | Add hooks, enableUserHooks, migrateModel |
| `src/core/storage/SettingsStorage.ts` | Modify | normalizeHooks, model migration on load |
| `src/core/hooks/commandHookAdapter.ts` | Create | shell command → SDK hook adapter |
| `src/core/agent/ObsidianCodeService.ts` | Modify | Merge user hooks at ~line 523 |
| `src/core/omc/OMCDetector.ts` | Create | Detect OMC installation |
| `src/core/omc/OMCSkillsLoader.ts` | Create | Scan skills → slash commands |
| `src/core/omc/OMCHUDProvider.ts` | Create | Poll state files, emit HUDData |
| `src/core/omc/OMCMCPImporter.ts` | Create | Read ~/.claude MCP candidates |
| `src/core/omc/CLIBridge.ts` | Create | Subprocess for advanced OMC features |
| `src/ui/components/OMCHUDView.ts` | Create | Sticky bottom status bar |
| `src/ui/renderers/MessageMetaRenderer.ts` | Create | Per-message token badge |
| `src/style/components/omc-hud.css` | Create | HUD + meta CSS |
| `src/style/index.css` | Modify | Register CSS after plan-banner.css |
| `src/features/chat/ObsidianCodeView.ts` | Modify | Private fields + OMC init/cleanup |
| `src/features/chat/controllers/StreamController.ts` | Modify | Emit MessageMeta on 'usage' chunk |
| `src/features/settings/ObsidianCodeSettings.ts` | Modify | enableUserHooks toggle |
