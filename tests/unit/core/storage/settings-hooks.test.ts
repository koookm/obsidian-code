import { DEFAULT_SETTINGS, migrateModel } from '@/core/types';

describe('DEFAULT_SETTINGS hooks fields', () => {
  it('has empty hooks config by default', () => {
    expect(DEFAULT_SETTINGS.hooks).toEqual({});
  });

  it('has enableUserHooks true by default', () => {
    expect(DEFAULT_SETTINGS.enableUserHooks).toBe(true);
  });
});

describe('migrateModel', () => {
  it('preserves current full model IDs', () => {
    expect(migrateModel('claude-fable-5')).toBe('claude-fable-5');
    expect(migrateModel('claude-opus-4-8')).toBe('claude-opus-4-8');
    expect(migrateModel('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });

  it('preserves CLI aliases', () => {
    expect(migrateModel('fable')).toBe('fable');
    expect(migrateModel('sonnet')).toBe('sonnet');
    expect(migrateModel('opus')).toBe('opus');
    expect(migrateModel('haiku')).toBe('haiku');
  });

  it('maps superseded pinned opus to the current pinned opus', () => {
    expect(migrateModel('claude-opus-4-7')).toBe('claude-opus-4-8');
  });

  it('falls back to the default model for removed legacy models', () => {
    expect(migrateModel('claude-opus-4-6')).toBe('fable');
    expect(migrateModel('claude-haiku-4-5')).toBe('fable');
    expect(migrateModel('claude-sonnet-4-5')).toBe('fable');
  });

  it('falls back to the default model for unknown strings and empty input', () => {
    expect(migrateModel('claude-2.1')).toBe('fable');
    expect(migrateModel('')).toBe('fable');
  });
});
