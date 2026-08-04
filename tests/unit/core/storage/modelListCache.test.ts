import { StorageService } from '@/core/storage/StorageService';

/**
 * Regression coverage for the model list cache persisted in data.json.
 *
 * The cache is machine state. If the migration path mistakes it for legacy
 * settings, every launch re-runs a "migration" that blanks the cache before
 * anything reads it — so a freshly fetched model list never survives a restart.
 */
describe('modelListCache and the legacy migration path', () => {
  const CACHE = {
    models: [{ value: 'claude-opus-5', label: 'Opus 5', description: '' }],
    fetchedAt: 1_700_000_000_000,
  };

  function createService(data: Record<string, unknown>) {
    const plugin = {
      app: { vault: { adapter: {} } },
      loadData: jest.fn().mockResolvedValue(data),
      saveData: jest.fn().mockResolvedValue(undefined),
    };
    return { service: new StorageService(plugin as never), plugin };
  }

  it('does not treat a cached model list as pending legacy settings', () => {
    const { service } = createService({});
    expect(
      service.needsMigration({
        activeConversationId: null,
        lastEnvHash: '',
        modelListCache: CACHE,
      } as never)
    ).toBe(false);
  });

  it('still detects real legacy settings alongside the cache', () => {
    const { service } = createService({});
    expect(
      service.needsMigration({ modelListCache: CACHE, systemPrompt: 'hi' } as never)
    ).toBe(true);
  });

  it('carries the cache through a migration instead of blanking it', async () => {
    const { service, plugin } = createService({});
    await service.runMigration(
      { modelListCache: CACHE, lastEnvHash: 'abc' } as never,
      { migrateSettings: false }
    );

    const saved = plugin.saveData.mock.calls.at(-1)?.[0];
    expect(saved.modelListCache).toEqual(CACHE);
  });

  it('drops a malformed cache rather than persisting it', async () => {
    const { service, plugin } = createService({});
    await service.runMigration(
      { modelListCache: { models: 'nope' } } as never,
      { migrateSettings: false }
    );

    expect(plugin.saveData.mock.calls.at(-1)?.[0].modelListCache).toBeNull();
  });

  it('restores the cache from data.json on load', async () => {
    const { service } = createService({ modelListCache: CACHE });
    const state = await service.loadState();
    expect(state.modelListCache).toEqual(CACHE);
  });
});
