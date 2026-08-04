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

  it('redirects retired pinned IDs to their family alias', () => {
    expect(migrateModel('claude-opus-4-7')).toBe('opus');
    expect(migrateModel('claude-opus-4-6')).toBe('opus');
    expect(migrateModel('claude-opus-4-5')).toBe('opus');
    expect(migrateModel('claude-sonnet-4-5')).toBe('sonnet');
  });

  it('preserves model IDs this build has never heard of', () => {
    // Models released after this build shipped must survive the migration.
    expect(migrateModel('claude-opus-9')).toBe('claude-opus-9');
    expect(migrateModel('claude-lyric-1')).toBe('claude-lyric-1');
    expect(migrateModel('claude-haiku-4-5')).toBe('claude-haiku-4-5');
  });

  it('falls back to the default model for unknown strings and empty input', () => {
    expect(migrateModel('claude-2.1')).toBe('fable');
    expect(migrateModel('some model name')).toBe('fable');
    expect(migrateModel('')).toBe('fable');
  });
});
