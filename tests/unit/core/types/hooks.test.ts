import type { HookCommandSpec,HooksConfig } from '@/core/types/hooks';

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
