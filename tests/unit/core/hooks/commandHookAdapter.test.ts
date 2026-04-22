/**
 * Tests for the command hook adapter.
 *
 * Covers environment scrubbing (sensitive keys removed) and
 * HooksConfig → async-function map expansion.
 */

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
      DB_PASSWORD: 'hunter2',
      API_SECRET: 'shhh',
      MY_CREDENTIAL: 'cred',
    };
    const result = scrubSensitiveEnv(env);
    expect(result.PATH).toBe('/usr/bin');
    expect(result.AUTHOR).toBe('alice');
    expect(result.HOME).toBe('/home/user');
    expect(result.KEYBOARD_LAYOUT).toBe('us');
    expect(result.ANTHROPIC_API_KEY).toBeUndefined();
    expect(result.MY_TOKEN).toBeUndefined();
    expect(result.GITHUB_AUTH_TOKEN).toBeUndefined();
    expect(result.DB_PASSWORD).toBeUndefined();
    expect(result.API_SECRET).toBeUndefined();
    expect(result.MY_CREDENTIAL).toBeUndefined();
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

  it('skips events with no matchers', () => {
    const cfg: HooksConfig = {
      Stop: [],
      PreToolUse: [{ hooks: [{ type: 'command', command: 'echo pre' }] }],
    };
    const result = expandUserHooks(cfg, '/vault');
    expect(result.Stop).toBeUndefined();
    expect(result.PreToolUse).toHaveLength(1);
  });

  it('flattens multiple hook specs under one matcher into a single array', () => {
    const cfg: HooksConfig = {
      PostToolUse: [
        {
          hooks: [
            { type: 'command', command: 'cmd1' },
            { type: 'command', command: 'cmd2' },
          ],
        },
      ],
    };
    const result = expandUserHooks(cfg, '/vault');
    expect(result.PostToolUse).toHaveLength(2);
  });
});
