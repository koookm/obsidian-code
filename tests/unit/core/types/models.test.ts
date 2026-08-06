import { readFileSync } from 'fs';
import { join } from 'path';

import { buildModelCatalog } from '@/core/models/ModelCatalog';
import {
  DEFAULT_CLAUDE_MODELS,
  DEFAULT_MODEL,
  FAMILY_THINKING_BUDGET,
  fetchAvailableModels,
  getDefaultThinkingBudget,
  hasModelApiKey,
} from '@/core/types/models';

describe('model list fetching', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  const okResponse = (body: unknown) => ({ ok: true, json: async () => body });

  describe('hasModelApiKey', () => {
    it('is false when no API key is configured', () => {
      expect(hasModelApiKey()).toBe(false);
    });

    it('is true when an API key is configured', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      expect(hasModelApiKey()).toBe(true);
    });
  });

  describe('fetchAvailableModels', () => {
    it('returns null without an API key, and issues no request', async () => {
      await expect(fetchAvailableModels()).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // Regression: the old CLI path ran `claude api get /v1/models`, but the CLI
    // has no `api` subcommand — it was parsed as a prompt and silently billed an
    // inference query whose text output could never parse as JSON.
    //
    // Asserted against the module source rather than with a child_process spy:
    // the old code bound `promisify(execFile)` at module load, so a spy
    // installed later would never have seen the call.
    it('never shells out to the Claude CLI', () => {
      const source = readFileSync(
        join(__dirname, '../../../../src/core/types/models.ts'),
        'utf8',
      );
      expect(source).not.toMatch(/child_process/);
      expect(source).not.toMatch(/execFile|spawn|execSync/);
      expect(source).not.toMatch(/'api', 'get'/);
    });

    it('parses the model list from the REST API when a key is present', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      fetchMock.mockResolvedValueOnce(okResponse({
        data: [
          { id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5', context_window: 200000 },
          { id: 'claude-opus-5', display_name: 'Claude Opus 5', context_window: 200000 },
        ],
      }));

      const models = await fetchAvailableModels();

      expect(models).toEqual([
        { value: 'claude-sonnet-5', label: 'Claude Sonnet 5', description: '컨텍스트 200k 토큰' },
        { value: 'claude-opus-5', label: 'Claude Opus 5', description: '컨텍스트 200k 토큰' },
      ]);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-api-key': 'sk-ant-test' }),
        }),
      );
    });

    it('returns null on a non-ok response', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
      await expect(fetchAvailableModels()).resolves.toBeNull();
    });

    it('returns null when the request throws', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      fetchMock.mockRejectedValueOnce(new Error('offline'));
      await expect(fetchAvailableModels()).resolves.toBeNull();
    });

    it('returns null when the response carries no usable models', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      fetchMock.mockResolvedValueOnce(okResponse({ data: [{ id: 'gpt-4' }] }));
      await expect(fetchAvailableModels()).resolves.toBeNull();
    });
  });
});

describe('DEFAULT_CLAUDE_MODELS', () => {
  it('is an offline fallback of pinned ids only — aliases are derived by the catalog', () => {
    const ids = DEFAULT_CLAUDE_MODELS.map(m => m.value);
    expect(ids.every(id => id.startsWith('claude-'))).toBe(true);
    expect(ids).not.toContain('fable');
    expect(ids).not.toContain('opus');
  });

  it('covers the current version of every family', () => {
    const ids = DEFAULT_CLAUDE_MODELS.map(m => m.value);
    expect(ids).toContain('claude-fable-5');
    expect(ids).toContain('claude-opus-5');
    expect(ids).toContain('claude-sonnet-5');
    expect(ids).toContain('claude-haiku-4-5');
  });

  it('excludes superseded versions beyond the immediately previous one', () => {
    const ids = DEFAULT_CLAUDE_MODELS.map(m => m.value);
    expect(ids).not.toContain('claude-opus-4-7');
    expect(ids).not.toContain('claude-opus-4-6');
    expect(ids).not.toContain('claude-sonnet-4-5');
  });

  it('resolves the opus alias to Opus 5, not the previous version', () => {
    const catalog = buildModelCatalog(DEFAULT_CLAUDE_MODELS);
    expect(catalog.latest.find(m => m.value === 'opus')?.resolvedId).toBe('claude-opus-5');
  });
});

describe('DEFAULT_MODEL', () => {
  it('defaults to the latest Fable CLI alias', () => {
    expect(DEFAULT_MODEL).toBe('fable');
  });

  it('is offered by the catalog built from the fallback list', () => {
    const catalog = buildModelCatalog(DEFAULT_CLAUDE_MODELS);
    expect(catalog.all.map(m => m.value)).toContain(DEFAULT_MODEL);
  });
});

describe('getDefaultThinkingBudget', () => {
  it('resolves CLI aliases', () => {
    expect(getDefaultThinkingBudget('fable')).toBe('medium');
    expect(getDefaultThinkingBudget('opus')).toBe('medium');
    expect(getDefaultThinkingBudget('sonnet')).toBe('low');
    expect(getDefaultThinkingBudget('haiku')).toBe('off');
  });

  it('resolves pinned ids through their family', () => {
    expect(getDefaultThinkingBudget('claude-fable-5')).toBe('medium');
    expect(getDefaultThinkingBudget('claude-opus-4-8')).toBe('medium');
    expect(getDefaultThinkingBudget('claude-sonnet-4-6')).toBe('low');
    expect(getDefaultThinkingBudget('claude-haiku-4-5')).toBe('off');
  });

  it('covers unreleased versions of a known family', () => {
    expect(getDefaultThinkingBudget('claude-sonnet-9')).toBe('low');
    expect(getDefaultThinkingBudget('claude-opus-42-1')).toBe('medium');
  });

  it('falls back to medium for unknown families and empty input', () => {
    expect(getDefaultThinkingBudget('claude-lyric-1')).toBe('medium');
    expect(getDefaultThinkingBudget('')).toBe('medium');
  });

  it('matches the family table', () => {
    expect(FAMILY_THINKING_BUDGET).toEqual({
      fable: 'medium',
      opus: 'medium',
      sonnet: 'low',
      haiku: 'off',
    });
  });
});
