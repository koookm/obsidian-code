# obsidian-code v1.4.26 — OMC Integration & Hooks Extension Design

**Date:** 2026-04-21  
**Version:** v1.4.26  
**Status:** Approved

---

## Overview

Two complementary feature sets for obsidian-code v1.4.26:

1. **Hooks Extension** — Expose the full Claude Code hooks schema (`SessionStart`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `Notification`, `PreCompact`) to user-defined shell commands via `settings.json`, matching Claude Code CLI behavior.

2. **OMC Integration** — When oh-my-claudecode (OMC) is installed, surface its skills as slash commands, display a live HUD status bar, show per-message token metadata, auto-import MCP servers, and selectively delegate advanced features to the OMC CLI.

These two features connect: OMC's `SessionStart` hook injects context into the plugin at session start via the newly-exposed hooks infrastructure.

---

## Scope & Constraints

- **OMC not installed:** All OMC modules are no-ops. Existing plugin behavior unchanged.
- **Model floor:** Only Claude 4.6+ models displayed. `claude-haiku-4-5` and all `claude-3-*` removed from selector. Default: `claude-sonnet-4-6`.
- **Approach:** Hybrid C — filesystem integration (B) for daily use; CLI bridge (A) for explicit advanced features (teams, ralph, subagents).
- **No SDK upgrade required:** The Agent SDK already supports all hook event types.

---

## Architecture

### New Files (8)

```
src/core/types/hooks.ts              HookEvent types, HooksConfig schema
src/core/omc/OMCDetector.ts          Detect OMC installation + version
src/core/omc/OMCSkillsLoader.ts      Scan skills → slash commands
src/core/omc/OMCHUDProvider.ts       Collect HUD state data
src/core/omc/OMCMCPImporter.ts       Auto-import MCP servers from ~/.claude
src/core/omc/CLIBridge.ts            Subprocess bridge for advanced OMC features
src/core/hooks/commandHookAdapter.ts  command hook → SDK hook function adapter
ui/components/OMCHUDView.ts          Bottom status bar component
ui/renderers/MessageMetaRenderer.ts  Per-message token/model badge
```

### Modified Files (5)

```
src/core/agent/ObsidianCodeService.ts  ChatService hooks merge
src/core/storage/SettingsStorage.ts    normalizeHooks(), new defaults
src/core/models/ModelRegistry.ts       4.6+ model filter
src/features/chat/ObsidianCodeView.ts  Mount OMCHUDView, wire providers
src/ui/SettingsTab.ts                  enableUserHooks toggle, OMC MCP section
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
  timeout?: number;  // ms, default 60_000
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

- Input: JSON event context on stdin
- Output: JSON decision on stdout (`{ "continue": true/false }`) or exit code (`0` = allow, `2` = deny)
- Fail-open: on error or parse failure → `{ continue: true }`

### Command Hook Adapter (`src/core/hooks/commandHookAdapter.ts`)

- `createCommandHookExecutor(spec, event)` → async SDK hook function
- Uses `child_process.spawn` with `shell: true`, configurable timeout
- Passes `CLAUDE_HOOK_EVENT` env var to subprocess
- `expandUserHooks(config)` → merges into SDK hook arrays

### ChatService Integration

Internal hooks (blocklistHook, vaultRestrictionHook, etc.) prepended. User hooks appended:

```typescript
options.hooks = {
  PreToolUse:      [blocklistHook, vaultRestrictionHook, fileHashPreHook, ...userHooks.PreToolUse],
  PostToolUse:     [fileHashPostHook, ...userHooks.PostToolUse],
  SessionStart:     userHooks.SessionStart     ?? [],
  UserPromptSubmit: userHooks.UserPromptSubmit ?? [],
  Stop:             userHooks.Stop             ?? [],
  SubagentStop:     userHooks.SubagentStop     ?? [],
  Notification:     userHooks.Notification     ?? [],
  PreCompact:       userHooks.PreCompact       ?? [],
};
```

### Security Guards

- `enableUserHooks` kill switch (UI toggle + settings field)
- Warning modal on first user hook registration
- `permissionMode: "plan"` → user hooks skipped entirely
- Timeout enforced: default 60s, max configurable

---

## Feature 2: OMC Integration

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

### OMCSkillsLoader (`src/core/omc/OMCSkillsLoader.ts`)

- Scans `{pluginRoot}/skills/*/SKILL.md`
- Parses name, description, trigger patterns from frontmatter
- Registers as slash commands with `[OMC]` badge in input dropdown
- On invocation: prepends SKILL.md content to system prompt for that turn
- Also injects `~/.claude/CLAUDE.md` (OMC operating principles) into base system prompt

### OMCHUDProvider (`src/core/omc/OMCHUDProvider.ts`)

Data sources (priority order):
1. `node ~/.claude/hud/omc-hud.mjs` output (300ms polling, when CLI available)
2. Direct `.omc/state/` file reads (fallback)
3. Agent SDK `usage_metadata` (context %)

Emits `HUDData` events consumed by `OMCHUDView`.

### OMCHUDView (`ui/components/OMCHUDView.ts`)

Fixed bottom strip in chat view (`position: sticky`). Hidden when OMC not installed.

```
[OMC] skill:planner │ ctx:67% │ agents:2 │ ralph:3/10 │ todos:2/5
```

| Element | Source |
|---------|--------|
| `skill:name` | `.omc/state/` activeSkill |
| `ctx:N%` | Agent SDK usage_metadata |
| `agents:N` | Agent SDK subagent count |
| `ralph:N/M` | `.omc/state/` ralph state |
| `todos:N/M` | Agent SDK TodoWrite count |

Color coding: green (normal) → yellow (ctx >70%) → red (ctx >85%).

### MessageMetaRenderer (`ui/renderers/MessageMetaRenderer.ts`)

Collapsible badge appended to each assistant message. Collapsed by default.

```
▸ claude-sonnet-4-6 │ ↑1,240 ↓892 tok │ 🧠 4,096 │ 1.2s
```

Data from `StreamController` on message completion: `usage_metadata` + `model` + elapsed ms.

### OMCMCPImporter (`src/core/omc/OMCMCPImporter.ts`)

- Reads `~/.claude/settings.json` for `mcpServers` entries
- Filters to supported transport types (stdio, http)
- Merges into plugin MCP config on first run + OMC detection
- Skips already-registered servers
- Settings UI: "Imported from OMC" section with per-server toggle

### CLIBridge (`src/core/omc/CLIBridge.ts`)

Triggered only on explicit user input:

| Input Pattern | Action |
|---------------|--------|
| `/team N:role "task"` | `omc team N:role "task"` subprocess |
| `ralph:` prefix | `claude --ralph` session spawn |
| `/oh-my-claudecode:*` skill | skill CLI execution |

Streams subprocess stdout through existing `StreamController`. Limits: 1 concurrent bridge process. On user cancel: `SIGTERM` → 2s → `SIGKILL`. Disabled in `permissionMode: "plan"`.

---

## Model Filtering

```typescript
const MIN_VERSION = { major: 4, minor: 6 };

function isAllowed(modelId: string): boolean {
  const m = modelId.match(/claude-(?:\w+-)?(\d+)-(\d+)/);
  if (!m) return false;
  const [major, minor] = [+m[1], +m[2]];
  return major > MIN_VERSION.major ||
    (major === MIN_VERSION.major && minor >= MIN_VERSION.minor);
}
```

Shown: `claude-opus-4-7`, `claude-sonnet-4-6`. Hidden: `claude-haiku-4-5`, `claude-3-*`.  
Default model: `claude-sonnet-4-6`.

---

## Data Flow

```
Settings load
  └─ normalizeHooks() → HooksConfig
  └─ OMCDetector.detect() → OMCInstall | null

Session start
  └─ Hooks: SessionStart fired (user hooks + OMC hook)
  └─ OMCSkillsLoader.load() → slash commands registered
  └─ OMCMCPImporter.sync() → MCP servers merged
  └─ OMCHUDProvider.start() → 300ms poll loop

User sends message
  └─ Hooks: UserPromptSubmit fired
  └─ [if skill invoked] SKILL.md prepended to system prompt
  └─ [if /team or ralph] CLIBridge.spawn()
  └─ Agent SDK query()
     └─ Hooks: PreToolUse / PostToolUse per tool call
     └─ Stream → StreamController → MessageMetaRenderer
  └─ Hooks: Stop fired

HUD bar
  └─ OMCHUDProvider emits HUDData → OMCHUDView re-renders
```

---

## Compatibility & Migration

- **Existing users:** `hooks: {}` default → no change in behavior
- **OMC not installed:** All `core/omc/*` modules silently disabled
- **Old model settings:** If saved model is below 4.6, reset to `claude-sonnet-4-6` on load
- **MCP dedup:** Importer checks by server name before adding

---

## Implementation Path

```
Fork:   github.com/koookm/cc-obsidian-ksk
Branch: feat/v1.4.26-omc-hooks
```

Suggested order:
1. `types/hooks.ts` + `SettingsStorage` normalize
2. `commandHookAdapter.ts` + `ChatService` merge
3. `ModelRegistry` filter
4. `OMCDetector` + `OMCSkillsLoader`
5. `OMCHUDProvider` + `OMCHUDView`
6. `MessageMetaRenderer`
7. `OMCMCPImporter`
8. `CLIBridge`
9. Settings UI additions
10. Tests: SettingsStorage, commandHookAdapter, OMCDetector, ModelRegistry

---

## Test Plan

| Area | Scenarios |
|------|-----------|
| Hooks | SessionStart fires on init; PreToolUse deny blocks tool; exit 2 = deny; timeout enforced; enableUserHooks=false skips all |
| OMC Detection | Installed → OMCInstall populated; Not installed → null, no errors |
| Skills | Skill CLAUDE.md injected into system prompt; slash dropdown shows [OMC] badge |
| HUD | Renders when OMC installed; hidden when not; ctx% updates from SDK |
| Model Filter | haiku-4-5 excluded; sonnet-4-6 default; dynamic fetch filtered |
| MCP Import | Duplicate skipped; new server merged; toggle disables |
| CLI Bridge | /team triggers subprocess; plan mode blocks; cancel SIGTERM |
