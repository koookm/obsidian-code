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
    expect(migrateModel('claude-opus-4-7')).toBe('claude-opus-4-7');
    expect(migrateModel('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });

  it('preserves CLI aliases', () => {
    expect(migrateModel('sonnet')).toBe('sonnet');
    expect(migrateModel('opus')).toBe('opus');
    expect(migrateModel('haiku')).toBe('haiku');
  });

  it('falls back to claude-sonnet-4-6 for removed legacy models', () => {
    expect(migrateModel('claude-opus-4-6')).toBe('claude-sonnet-4-6');
    expect(migrateModel('claude-haiku-4-5')).toBe('claude-sonnet-4-6');
    expect(migrateModel('claude-sonnet-4-5')).toBe('claude-sonnet-4-6');
  });

  it('falls back to claude-sonnet-4-6 for unknown strings and empty input', () => {
    expect(migrateModel('claude-2.1')).toBe('claude-sonnet-4-6');
    expect(migrateModel('')).toBe('claude-sonnet-4-6');
  });
});
