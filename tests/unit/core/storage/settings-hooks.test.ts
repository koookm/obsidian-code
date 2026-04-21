import { DEFAULT_SETTINGS } from '@/core/types';

describe('DEFAULT_SETTINGS hooks fields', () => {
  it('has empty hooks config by default', () => {
    expect(DEFAULT_SETTINGS.hooks).toEqual({});
  });

  it('has enableUserHooks true by default', () => {
    expect(DEFAULT_SETTINGS.enableUserHooks).toBe(true);
  });
});
