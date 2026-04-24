/**
 * ObsidianCode - User command hook adapter
 *
 * Bridges user-defined shell-command hooks (configured via settings.hooks)
 * into the Claude Agent SDK hook pipeline. Each matcher is expanded into
 * an async function that spawns the command, forwards the SDK hook input
 * over stdin, and interprets the child's stdout/exit-code as a hook response.
 *
 * Desktop-only — Node `child_process` is unavailable on mobile, so this
 * module returns an empty map on non-desktop platforms.
 */

import { spawn } from 'child_process';
import { Platform } from 'obsidian';

import type { HookCommandSpec, HookEvent, HooksConfig } from '../types/hooks';
import { HOOK_EVENTS } from '../types/hooks';

const SENSITIVE_SUFFIX = /_(API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH_TOKEN)$/i;

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;
const DENY_EXIT_CODE = 2;

export type HookInput = unknown;
export type HookOutput = Record<string, unknown>;
export type HookExecutor = (input: HookInput) => Promise<HookOutput>;

export function scrubSensitiveEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([k]) => !SENSITIVE_SUFFIX.test(k))
  );
}

function extractToolName(input: HookInput): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  const name = obj.tool_name ?? obj.toolName;
  return typeof name === 'string' ? name : '';
}

function execCommand(
  spec: HookCommandSpec,
  event: HookEvent,
  hookInput: HookInput,
  vaultPath: string
): Promise<HookOutput> {
  return new Promise((resolve) => {
    const timeout = Math.min(spec.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const child = spawn(spec.command, {
      shell: true,
      timeout,
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
      if (code === DENY_EXIT_CODE) {
        resolve({
          hookSpecificOutput: {
            hookEventName: event,
            permissionDecision: 'deny',
            permissionDecisionReason: stderr.trim() || 'Hook denied',
          },
        });
        return;
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
): HookExecutor {
  return async (hookInput: HookInput) => {
    if (!Platform.isDesktop) return {};
    return execCommand(spec, event, hookInput, vaultPath);
  };
}

export function expandUserHooks(
  config: HooksConfig,
  vaultPath: string
): Partial<Record<HookEvent, HookExecutor[]>> {
  if (!Platform.isDesktop) return {};

  const result: Partial<Record<HookEvent, HookExecutor[]>> = {};
  for (const event of HOOK_EVENTS) {
    const matchers = config[event];
    if (!matchers?.length) continue;
    const fns: HookExecutor[] = [];
    for (const matcher of matchers) {
      for (const hookSpec of matcher.hooks) {
        fns.push(createCommandHookExecutor(hookSpec, event, vaultPath));
      }
    }
    if (fns.length) result[event] = fns;
  }
  return result;
}
