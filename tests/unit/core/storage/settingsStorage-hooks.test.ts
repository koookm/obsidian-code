/**
 * Tests for normalizeHooks in SettingsStorage.
 *
 * Ensures persisted hooks JSON is sanitised before the adapter wires it
 * into the SDK: unknown events dropped, timeouts clamped, invalid regex
 * matchers rejected, malformed hook specs filtered out.
 */

import { normalizeHooks } from '@/core/storage/SettingsStorage';

describe('normalizeHooks', () => {
  it('returns empty object for null/undefined', () => {
    expect(normalizeHooks(null)).toEqual({});
    expect(normalizeHooks(undefined)).toEqual({});
  });

  it('returns empty object for non-object input', () => {
    expect(normalizeHooks('hooks')).toEqual({});
    expect(normalizeHooks(42)).toEqual({});
  });

  it('drops unknown events', () => {
    const result = normalizeHooks({ UnknownEvent: [] });
    expect((result as Record<string, unknown>).UnknownEvent).toBeUndefined();
  });

  it('clamps timeout to [1000, 300000]', () => {
    const result = normalizeHooks({
      Stop: [{ hooks: [{ type: 'command', command: 'x', timeout: 0 }] }],
    });
    expect(result.Stop?.[0].hooks[0].timeout).toBe(1_000);

    const capped = normalizeHooks({
      Stop: [{ hooks: [{ type: 'command', command: 'x', timeout: 999_999 }] }],
    });
    expect(capped.Stop?.[0].hooks[0].timeout).toBe(300_000);
  });

  it('leaves timeout undefined when not provided', () => {
    const result = normalizeHooks({
      Stop: [{ hooks: [{ type: 'command', command: 'x' }] }],
    });
    expect(result.Stop?.[0].hooks[0].timeout).toBeUndefined();
  });

  it('drops matchers with invalid regex', () => {
    const result = normalizeHooks({
      PreToolUse: [{ matcher: '[invalid', hooks: [{ type: 'command', command: 'x' }] }],
    });
    expect(result.PreToolUse).toHaveLength(0);
  });

  it('drops hook specs that are not type=command with a string command', () => {
    const result = normalizeHooks({
      PostToolUse: [{
        hooks: [
          { type: 'command', command: 'good' },
          { type: 'other', command: 'bad' },
          { type: 'command', command: 42 },
          null,
        ],
      }],
    });
    expect(result.PostToolUse?.[0].hooks).toHaveLength(1);
    expect(result.PostToolUse?.[0].hooks[0].command).toBe('good');
  });

  it('keeps valid config intact', () => {
    const result = normalizeHooks({
      SessionStart: [{ matcher: 'resume', hooks: [{ type: 'command', command: 'echo hi' }] }],
    });
    expect(result.SessionStart?.[0].matcher).toBe('resume');
    expect(result.SessionStart?.[0].hooks[0].command).toBe('echo hi');
  });

  it('skips events where matchers field is not an array', () => {
    const result = normalizeHooks({ Stop: 'not-an-array' });
    expect(result.Stop).toBeUndefined();
  });
});
