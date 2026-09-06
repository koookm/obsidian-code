import { ChangeJournal, JOURNAL_PATH } from '@/core/journal/ChangeJournal';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

type MockAdapter = VaultFileAdapter & {
  _store: Record<string, string>;
  _mtimes: Record<string, number>;
};

function createMockAdapter(files: Record<string, string> = {}): MockAdapter {
  const store: Record<string, string> = { ...files };
  const mtimes: Record<string, number> = {};

  return {
    exists: async (path: string) => path in store,
    read: async (path: string) => {
      if (!(path in store)) throw new Error(`File not found: ${path}`);
      return store[path];
    },
    write: async (path: string, content: string) => {
      store[path] = content;
    },
    append: async (path: string, content: string) => {
      store[path] = (store[path] ?? '') + content;
    },
    delete: async (path: string) => {
      delete store[path];
    },
    listFiles: async (folder: string) =>
      Object.keys(store).filter((p) => p.startsWith(`${folder}/`)),
    stat: async (path: string) =>
      path in store ? { mtime: mtimes[path] ?? 0, size: store[path].length } : null,
    _store: store,
    _mtimes: mtimes,
  } as unknown as MockAdapter;
}

const base = { planId: 'plan-1', toolName: 'Edit' };

describe('ChangeJournal.record / load', () => {
  it('returns an empty list when the plan has no journal', async () => {
    const journal = new ChangeJournal(createMockAdapter());
    expect(await journal.load('missing')).toEqual([]);
  });

  it('appends records as JSONL and reads them back in order', async () => {
    const adapter = createMockAdapter();
    const journal = new ChangeJournal(adapter);

    await journal.record({ ...base, filePath: 'a.md', before: 'A', after: 'A1', timestamp: 1 });
    await journal.record({ ...base, filePath: 'b.md', before: null, after: 'B', timestamp: 2 });

    const records = await journal.load('plan-1');
    expect(records.map((r) => r.filePath)).toEqual(['a.md', 'b.md']);
    expect(records[0]).toMatchObject({ before: 'A', after: 'A1', toolName: 'Edit' });
    expect(records[1].before).toBeNull();
    expect(adapter._store[`${JOURNAL_PATH}/plan-1.jsonl`].trim().split('\n')).toHaveLength(2);
  });

  it('skips malformed lines instead of failing the whole load', async () => {
    const good = JSON.stringify({
      planId: 'plan-1',
      filePath: 'a.md',
      toolName: 'Edit',
      timestamp: 1,
      before: 'A',
      after: 'B',
    });
    const adapter = createMockAdapter({
      [`${JOURNAL_PATH}/plan-1.jsonl`]: `${good}\n{ not json\n\n`,
    });

    const records = await new ChangeJournal(adapter).load('plan-1');
    expect(records).toHaveLength(1);
    expect(records[0].filePath).toBe('a.md');
  });

  it('stores a skip reason instead of oversized content', async () => {
    const adapter = createMockAdapter();
    const journal = new ChangeJournal(adapter, { maxEntrySize: 10 });

    await journal.record({
      ...base,
      filePath: 'big.md',
      before: 'x'.repeat(50),
      after: 'y',
      timestamp: 1,
    });

    const [record] = await journal.load('plan-1');
    expect(record).toMatchObject({ before: null, after: null, skippedReason: 'too_large' });
  });

  it('rejects plan ids that would escape the journal folder', async () => {
    const journal = new ChangeJournal(createMockAdapter());
    await expect(
      journal.record({ ...base, planId: '../evil', filePath: 'a.md', before: '', after: 'x', timestamp: 1 })
    ).rejects.toThrow(/invalid plan id/i);
  });
});

describe('ChangeJournal.revert', () => {
  it('restores a file to its state before the first recorded change', async () => {
    const adapter = createMockAdapter({ 'a.md': 'v3' });
    const journal = new ChangeJournal(adapter);

    await journal.record({ ...base, filePath: 'a.md', before: 'v1', after: 'v2', timestamp: 1 });
    await journal.record({ ...base, filePath: 'a.md', before: 'v2', after: 'v3', timestamp: 2 });

    const result = await journal.revert('plan-1');

    expect(result.reverted).toEqual(['a.md']);
    expect(result.skipped).toEqual([]);
    expect(adapter._store['a.md']).toBe('v1');
  });

  it('deletes a file the plan created', async () => {
    const adapter = createMockAdapter({ 'new.md': 'created' });
    const journal = new ChangeJournal(adapter);

    await journal.record({
      ...base,
      filePath: 'new.md',
      before: null,
      after: 'created',
      timestamp: 1,
    });

    const result = await journal.revert('plan-1');

    expect(result.reverted).toEqual(['new.md']);
    expect('new.md' in adapter._store).toBe(false);
  });

  it('recreates a file the plan deleted', async () => {
    const adapter = createMockAdapter();
    const journal = new ChangeJournal(adapter);

    await journal.record({
      ...base,
      filePath: 'gone.md',
      before: 'original',
      after: null,
      timestamp: 1,
    });

    const result = await journal.revert('plan-1');

    expect(result.reverted).toEqual(['gone.md']);
    expect(adapter._store['gone.md']).toBe('original');
  });

  it('refuses to clobber a file edited after the plan ran', async () => {
    const adapter = createMockAdapter({ 'a.md': 'edited by the user' });
    const journal = new ChangeJournal(adapter);

    await journal.record({ ...base, filePath: 'a.md', before: 'v1', after: 'v2', timestamp: 1 });

    const result = await journal.revert('plan-1');

    expect(result.reverted).toEqual([]);
    expect(result.skipped).toEqual([{ filePath: 'a.md', reason: 'modified_since' }]);
    expect(adapter._store['a.md']).toBe('edited by the user');
  });

  it('overrides the conflict check when forced', async () => {
    const adapter = createMockAdapter({ 'a.md': 'edited by the user' });
    const journal = new ChangeJournal(adapter);

    await journal.record({ ...base, filePath: 'a.md', before: 'v1', after: 'v2', timestamp: 1 });

    const result = await journal.revert('plan-1', { force: true });

    expect(result.reverted).toEqual(['a.md']);
    expect(adapter._store['a.md']).toBe('v1');
  });

  it('skips files whose content was never captured', async () => {
    const adapter = createMockAdapter({ 'big.md': 'whatever' });
    const journal = new ChangeJournal(adapter, { maxEntrySize: 2 });

    await journal.record({
      ...base,
      filePath: 'big.md',
      before: 'original',
      after: 'changed',
      timestamp: 1,
    });

    const result = await journal.revert('plan-1');

    expect(result.reverted).toEqual([]);
    expect(result.skipped).toEqual([{ filePath: 'big.md', reason: 'not_captured' }]);
    expect(adapter._store['big.md']).toBe('whatever');
  });

  it('reports nothing to do for an unknown plan', async () => {
    const result = await new ChangeJournal(createMockAdapter()).revert('nope');
    expect(result).toEqual({ reverted: [], skipped: [] });
  });
});

describe('ChangeJournal housekeeping', () => {
  it('lists journalled plan ids', async () => {
    const adapter = createMockAdapter({
      [`${JOURNAL_PATH}/plan-a.jsonl`]: '',
      [`${JOURNAL_PATH}/plan-b.jsonl`]: '',
      [`${JOURNAL_PATH}/notes.txt`]: '',
    });

    const ids = await new ChangeJournal(adapter).listPlanIds();
    expect(ids.sort()).toEqual(['plan-a', 'plan-b']);
  });

  it('clears a plan journal', async () => {
    const adapter = createMockAdapter({ [`${JOURNAL_PATH}/plan-1.jsonl`]: '' });
    await new ChangeJournal(adapter).clear('plan-1');
    expect(`${JOURNAL_PATH}/plan-1.jsonl` in adapter._store).toBe(false);
  });

  it('prunes all but the most recently touched journals', async () => {
    const adapter = createMockAdapter({
      [`${JOURNAL_PATH}/old.jsonl`]: '',
      [`${JOURNAL_PATH}/mid.jsonl`]: '',
      [`${JOURNAL_PATH}/new.jsonl`]: '',
    });
    adapter._mtimes[`${JOURNAL_PATH}/old.jsonl`] = 1;
    adapter._mtimes[`${JOURNAL_PATH}/mid.jsonl`] = 2;
    adapter._mtimes[`${JOURNAL_PATH}/new.jsonl`] = 3;

    const removed = await new ChangeJournal(adapter).prune(2);

    expect(removed).toEqual(['old']);
    expect(`${JOURNAL_PATH}/old.jsonl` in adapter._store).toBe(false);
    expect(`${JOURNAL_PATH}/new.jsonl` in adapter._store).toBe(true);
  });
});
