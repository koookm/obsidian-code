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
