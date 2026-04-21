# obsidian-code v1.4.26 — OMC Integration & Hooks Extension Design

**Date:** 2026-04-21  
**Version:** v1.4.26  
**Status:** Approved (rev 3 — post spec-review corrections)

---

## Overview

Two complementary feature sets for obsidian-code v1.4.26:

1. **Hooks Extension** — Expose the full Claude Code hooks schema (`SessionStart`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `Notification`, `PreCompact`) to user-defined shell commands via `settings.json`, matching Claude Code CLI behavior.

2. **OMC Integration** — When oh-my-claudecode (OMC) is installed, surface its skills as slash commands, display a live HUD status bar, show per-message token metadata, auto-import MCP servers, and selectively delegate advanced features to the OMC CLI.

These two features connect: OMC's `SessionStart` hook injects context into the plugin at session start via the newly-exposed hooks infrastructure.

---

## Scope & Constraints

- **OMC not installed:** All OMC modules are no-ops. Existing plugin behavior unchanged.
- **Mobile (Obsidian mobile):** All OMC modules and user hooks are **desktop-only**. Every OMC module entry point gates on `Platform.isDesktop`. On mobile, `OMCDetector` returns `null`, `CLIBridge` and `OMCHUDProvider` are never instantiated, `commandHookAdapter` is disabled. HUD view and meta renderer are hidden.
- **Model floor:** Only Claude 4.6+ models displayed. Remove `claude-haiku-4-5`, `claude-sonnet-4-5`, `claude-opus-4-5`, `claude-opus-4-6` from `DEFAULT_CLAUDE_MODELS`. Default: `claude-sonnet-4-6`. If a user's saved model is below 4.6, reset to `claude-sonnet-4-6` on settings load.
- **Approach:** Hybrid C — filesystem integration (B) for daily use; CLI bridge (A) for explicit advanced features (teams, ralph, subagents).
- **No SDK upgrade required:** The Agent SDK already supports all hook event types; hook merge point is `src/core/agent/ObsidianCodeService.ts` ~line 523 (`options.hooks = {...}` assignment).

---

## Architecture

### New Files (8)

```
src/core/types/hooks.ts                   HookEvent types, HooksConfig schema
src/core/omc/OMCDetector.ts               Detect OMC installation + version
src/core/omc/OMCSkillsLoader.ts           Scan skills → slash commands
src/core/omc/OMCHUDProvider.ts            Collect HUD state data (desktop only)
src/core/omc/OMCMCPImporter.ts            Auto-import MCP servers from ~/.claude
src/core/omc/CLIBridge.ts                 Subprocess bridge for advanced OMC features (desktop only)
src/core/hooks/commandHookAdapter.ts       command hook → SDK hook function adapter (desktop only)
src/ui/components/OMCHUDView.ts           Bottom status bar component
src/ui/renderers/MessageMetaRenderer.ts   Per-message token/model badge
```

### Modified Files (5)

```
src/core/agent/ObsidianCodeService.ts          hooks merge at line ~524
src/core/storage/SettingsStorage.ts            normalizeHooks(), new defaults
src/core/types/models.ts                       Filter DEFAULT_CLAUDE_MODELS to 4.6+ only
src/features/chat/ObsidianCodeView.ts          Mount OMCHUDView, wire providers
src/features/settings/ObsidianCodeSettings.ts  enableUserHooks toggle, OMC MCP section
```

---

## Feature 1: Hooks Extension

### Types (`src/core/types/hooks.ts`)

```typescript
export type HookEvent =
  | "SessionStart" | "UserPromptSubmit"
  | "PreToolUse"   | "PostToolUse"
  | "Stop"         | "SubagentStop"
  | "Notification" | "PreCompact";

export interface HookCommandSpec {
  type: "command";
  command: string;
  timeout?: number;  // ms, default 60_000, max 300_000
}

export interface HookMatcher {
  matcher?: string;  // regex on tool name / session mode, default ".*"
  hooks: HookCommandSpec[];
}

export type HooksConfig = Partial<Record<HookEvent, HookMatcher[]>>;
```

### Settings Schema

```json
{
  "enableUserHooks": true,
  "hooks": {
    "SessionStart": [{ "matcher": "resume|compact", "hooks": [{ "type": "command", "command": "..." }] }],
    "PreToolUse":   [{ "matcher": "Bash|Edit",       "hooks": [{ "type": "command", "command": "..." }] }],
    "PostToolUse":  [{ "matcher": "Write",            "hooks": [...] }],
    "Stop":         [{ "hooks": [...] }]
  }
}
```

### I/O Protocol

Commands receive a JSON event context on stdin. Output:

- **exit code 0** — allow (continue)
- **exit code 2** — deny/block
- **stdout JSON** — optional feedback: `{ "hookSpecificOutput": { "additionalContext": "..." } }`
- **Fail-open:** on subprocess error, timeout, or stdout parse failure → allow (continue)

> Note: This protocol matches Claude Code CLI hooks. Do not use `{ "continue": true/false }` format.

### Command Hook Adapter (`src/core/hooks/commandHookAdapter.ts`)

**Desktop-only gate:** returns no-op array on `Platform.isMobile`.

All new OMC files must include: `import { Platform } from 'obsidian';`

```typescript
import { Platform } from 'obsidian';  // required in every omc/* and hooks/* file

export function createCommandHookExecutor(spec: HookCommandSpec, event: HookEvent) {
  return async (hookInput: unknown): Promise<any> => {
    // Guard: desktop only
    if (!Platform.isDesktop) return { decision: 'approve' };

    return new Promise((resolve) => {
      const child = spawn(spec.command, {
        shell: true,
        timeout: Math.min(spec.timeout ?? 60_000, 300_000),
        cwd: (app.vault.adapter as FileSystemAdapter).basePath,  // requires import { FileSystemAdapter } from 'obsidian'
        env: {
          ...scrubSensitiveEnv(process.env),
          CLAUDE_HOOK_EVENT: event,
          CLAUDE_HOOK_TOOL: extractToolName(hookInput),
        }
      });
      // ... stdin/stdout handling, exit code mapping
    });
  };
}

// Explicit denylist of suffix patterns — strip only known secrets, not PATH or user vars
// Extracts tool name from SDK hook input for CLAUDE_HOOK_TOOL env var
function extractToolName(input: unknown): string {
  return (input as any)?.tool_name ?? (input as any)?.toolName ?? '';
}

const SENSITIVE_SUFFIX = /_(API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH_TOKEN)$/i;
function scrubSensitiveEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([k]) => !SENSITIVE_SUFFIX.test(k))
  );
}
```

`expandUserHooks(config)` → merges into SDK hook arrays.

### ChatService (ObsidianCodeService) Integration

Target: `src/core/agent/ObsidianCodeService.ts` line ~524 — the existing `options.hooks` assignment.

Internal hooks (blocklistHook, vaultRestrictionHook, etc.) prepended. User hooks appended. `permissionMode: "plan"` check wired **before** `expandUserHooks()` call so plan mode skips user hooks at the call site, not inside the adapter:

```typescript
// this.queryOptions?.planMode reflects current plan mode state (see line ~529 in ObsidianCodeService)
const userHooks = (this.plugin.settings.enableUserHooks && !this.queryOptions?.planMode && Platform.isDesktop)
  ? expandUserHooks(this.plugin.settings.hooks)
  : {};

options.hooks = {
  PreToolUse:      [blocklistHook, vaultRestrictionHook, fileHashPreHook, ...(userHooks.PreToolUse ?? [])],
  PostToolUse:     [fileHashPostHook, ...(userHooks.PostToolUse ?? [])],
  SessionStart:     userHooks.SessionStart     ?? [],
  UserPromptSubmit: userHooks.UserPromptSubmit ?? [],
  Stop:             userHooks.Stop             ?? [],
  SubagentStop:     userHooks.SubagentStop     ?? [],
  Notification:     userHooks.Notification     ?? [],
  PreCompact:       userHooks.PreCompact       ?? [],
};
```

### normalizeHooks (`src/core/storage/SettingsStorage.ts`)

Validate on load: regex compile check for `matcher`, timeout clamped to `[1_000, 300_000]`. Invalid entries logged and dropped.

### Security Guards

- `enableUserHooks` kill switch (settings UI toggle)
- **Warning modal on hooks config hash change** (not just first-use) — re-confirm whenever the `hooks` object in settings changes, since settings.json may be synced across vaults
- `permissionMode: "plan"` → `isInPlanMode()` check blocks user hooks at call site
- Child process `cwd` locked to vault root
- Sensitive env vars stripped before passing to child (`scrubSensitiveEnv`)
- `SessionStart` hook: one-fire debounce flag per session to prevent circular calls
- **Second CLIBridge invocation while one is running:** reject immediately with user notification (no queue, no replace)

---

## Feature 2: OMC Integration

All OMC modules check `Platform.isDesktop` at entry. On mobile: instantiate nothing, return null/empty gracefully.

### OMCDetector (`src/core/omc/OMCDetector.ts`)

Detection order:
1. Scan `~/.claude/plugins/cache/omc/oh-my-claudecode/` for versioned directories
2. Try `omc --version` CLI
3. Read `~/.claude/.omc-config.json`

```typescript
interface OMCInstall {
  version: string;
  pluginRoot: string;   // ~/.claude/plugins/cache/omc/oh-my-claudecode/{version}
  cliPath: string | null;
  configPath: string;
}
```

**Windows path handling:** use `path.join(os.homedir(), '.claude', ...)` everywhere — never hardcode POSIX `~/` paths.

On OMC uninstall mid-session: `OMCSkillsLoader.unload()` de-registers all OMC slash commands from the input dropdown.

### OMCSkillsLoader (`src/core/omc/OMCSkillsLoader.ts`)

- Scans `{pluginRoot}/skills/*/SKILL.md`
- Parses name, description, trigger patterns from frontmatter
- Registers as slash commands with `[OMC]` badge in input dropdown
- **Collision handling:** if OMC skill name matches an existing slash command, OMC variant is prefixed `omc:` (e.g. `/omc:plan` vs existing `/plan`)
- On invocation: prepends SKILL.md content to system prompt **for that turn only** (one-time injection, not persisted across turns)
- Injects `~/.claude/CLAUDE.md` once into the **base system prompt** at session start; re-injected on session resume

### OMCHUDProvider (`src/core/omc/OMCHUDProvider.ts`)

Data sources (priority order):
1. `node ~/.claude/hud/omc-hud.mjs` output (300ms polling when CLI available)
2. Direct `.omc/state/` file reads (fallback on non-zero exit or timeout)
3. Agent SDK `usage_metadata` (context % always from SDK)

**Lifecycle:** Start on view open (`onOpen`). Stop and clean up on view close (`onClose`) / plugin unload. Exponential backoff on repeated failures (max 5s interval). Subprocess killed on cleanup.

Emits `HUDData` events consumed by `OMCHUDView`.

### OMCHUDView (`src/ui/components/OMCHUDView.ts`)

Fixed bottom strip in chat view (`position: sticky; bottom: 0`). Hidden when OMC not installed or on mobile.

```
[OMC] skill:planner │ ctx:67% │ agents:2 │ ralph:3/10 │ todos:2/5
```

| Element | Source |
|---------|--------|
| `skill:name` | `.omc/state/` activeSkill |
| `ctx:N%` | Agent SDK `usage_metadata` |
| `agents:N` | Agent SDK subagent count (if available) |
| `ralph:N/M` | `.omc/state/` ralph state |
| `todos:N/M` | Agent SDK TodoWrite count |

Color coding: green (normal) → yellow (ctx >70%) → red (ctx >85%).

**Mobile:** component not mounted.

### MessageMetaRenderer (`src/ui/renderers/MessageMetaRenderer.ts`)

Collapsible badge appended to each assistant message. Collapsed by default; same toggle UX as thinking blocks.

```
▸ claude-sonnet-4-6 │ ↑1,240 ↓892 tok │ 🧠 4,096 │ 1.2s
```

Data collected from `StreamController` on `result` message (stream completion): `usage_metadata.input_tokens`, `usage_metadata.output_tokens`, `usage_metadata.cache_read_input_tokens`, `model`, elapsed ms. Renders only after stream completes — not during streaming.

### OMCMCPImporter (`src/core/omc/OMCMCPImporter.ts`)

- Reads `~/.claude/settings.json` for `mcpServers` entries (desktop only, Windows-safe paths)
- Filters to supported transport types (stdio, http)
- On detection: shows **opt-in modal** listing candidate servers — user explicitly approves each before import (no silent merge)
- Skips already-registered servers (match by name)
- Settings UI: "Imported from OMC" section with per-server toggle and remove button

### CLIBridge (`src/core/omc/CLIBridge.ts`)

Desktop-only. Triggered only on explicit user input:

| Input Pattern | Action |
|---------------|--------|
| `/team N:role "task"` | `omc team N:role "task"` subprocess |
| `ralph:` prefix | `claude --ralph` session spawn |
| `/oh-my-claudecode:*` skill (advanced) | skill CLI execution |

Streams subprocess stdout through existing `StreamController`. **Concurrency limit: 1.** Second invocation while active → reject with user notification. On user cancel: `SIGTERM` → 2s → `SIGKILL`. Disabled in `permissionMode: "plan"` and on mobile.

---

## Model Filtering (`src/core/types/models.ts`)

Remove from `DEFAULT_CLAUDE_MODELS`: `claude-haiku-4-5`, `claude-sonnet-4-5`, `claude-opus-4-5`, `claude-opus-4-6`.

Keep: `claude-opus-4-7`, `claude-sonnet-4-6`.

Default model: `claude-sonnet-4-6`.

`DEFAULT_THINKING_BUDGETS` entries for removed models also removed.

**Settings migration:** On `SettingsStorage.load()`, if saved `model` value is not in the new `DEFAULT_CLAUDE_MODELS` list, reset to `claude-sonnet-4-6`.

---

## Data Flow

```
Settings load
  └─ normalizeHooks() → HooksConfig (regex validated, timeouts clamped)
  └─ model migration check → reset if below 4.6
  └─ Platform.isDesktop check
     └─ [desktop] OMCDetector.detect() → OMCInstall | null

Session start
  └─ [desktop] Hooks: SessionStart fired (user hooks if enabled)
  └─ [desktop+OMC] OMCSkillsLoader.load() → slash commands registered
  └─ [desktop+OMC] OMCMCPImporter.sync() → opt-in modal if new servers found
  └─ [desktop+OMC] OMCHUDProvider.start() → polling loop with backoff

User sends message
  └─ Hooks: UserPromptSubmit fired (desktop + enabled only)
  └─ [if OMC skill invoked] SKILL.md prepended to system prompt (one-time)
  └─ [if /team or ralph] CLIBridge.spawn() (desktop, plan mode check)
  └─ Agent SDK query() (ObsidianCodeService.executeQuery)
     └─ Hooks: PreToolUse / PostToolUse per tool call
     └─ Stream → StreamController
        └─ on result: emit MessageMeta → MessageMetaRenderer badge
  └─ Hooks: Stop fired

HUD bar (desktop only)
  └─ OMCHUDProvider emits HUDData (300ms poll, backoff on failure)
  └─ OMCHUDView re-renders

View close / plugin unload
  └─ OMCHUDProvider.stop() — kills polling, cleans up subprocess
  └─ OMCSkillsLoader.unload() — de-registers slash commands
```

---

## Compatibility & Migration

- **Existing users:** `hooks: {}` default → no change in behavior
- **OMC not installed:** All `core/omc/*` modules return null/no-op, zero errors
- **Mobile:** All OMC + hooks features silently disabled via `Platform.isDesktop` gate
- **Old model settings:** If saved model not in 4.6+ list → reset to `claude-sonnet-4-6` on load
- **MCP dedup:** Importer checks by server name; opt-in modal prevents silent merge
- **Windows:** All filesystem paths via `path.join(os.homedir(), ...)` — no hardcoded POSIX `~/`

---

## Implementation Order

```
Fork:   github.com/koookm/cc-obsidian-ksk
Branch: feat/v1.4.26-omc-hooks
```

1. `src/core/types/hooks.ts` — type definitions
2. `src/core/storage/SettingsStorage.ts` — normalizeHooks, defaults
3. `src/core/types/models.ts` — filter DEFAULT_CLAUDE_MODELS, migration
4. `src/core/hooks/commandHookAdapter.ts` — desktop-only adapter + scrubSensitiveEnv
5. `src/core/agent/ObsidianCodeService.ts` — hooks merge at line ~524
6. `src/core/omc/OMCDetector.ts`
7. `src/core/omc/OMCSkillsLoader.ts`
8. `src/core/omc/OMCHUDProvider.ts` — lifecycle + backoff
9. `src/ui/components/OMCHUDView.ts`
10. `src/ui/renderers/MessageMetaRenderer.ts`
11. `src/core/omc/OMCMCPImporter.ts` — opt-in modal
12. `src/core/omc/CLIBridge.ts`
13. `src/features/settings/ObsidianCodeSettings.ts` — UI additions
14. Tests

---

## Test Plan

| Area | Scenarios |
|------|-----------|
| Hooks schema | normalizeHooks: invalid regex dropped; timeout clamped; unknown events ignored |
| Hooks execution | SessionStart fires on init (once); PreToolUse deny blocks tool; exit 2 = deny; timeout enforced; enableUserHooks=false skips all; plan mode skips all; mobile = no-op |
| Hooks security | Sensitive env vars stripped from child; settings hash change triggers re-confirm modal; vault cwd locked |
| OMC Detection | Installed → OMCInstall populated; Not installed → null, zero errors; Mobile → null always |
| Skills | SKILL.md injected for that turn only; slash dropdown shows [OMC] badge; name collision → omc: prefix; unload removes commands |
| HUD | Renders desktop+OMC; hidden mobile/no-OMC; ctx% from SDK; backoff on failure; cleaned up on view close |
| MessageMeta | Badge shows after stream complete; collapsed by default; not shown during streaming |
| Model filter | haiku-4-5/sonnet-4-5/opus-4-5/opus-4-6 excluded; sonnet-4-6 default; saved old model reset on load |
| MCP Import | Opt-in modal shown; duplicate skipped; toggle disables; Windows paths correct |
| CLI Bridge | /team triggers subprocess; plan mode blocks; mobile blocks; concurrent = reject; cancel SIGTERM→SIGKILL |
| Cross-platform | All ~/.claude paths via path.join; no POSIX-only assumptions |
