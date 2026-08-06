// eslint-disable-next-line jest/no-mocks-import
import { getLastOptions, resetMockMessages, setMockSupportedModels } from '@test/__mocks__/claude-agent-sdk';

import { fetchModelsFromCLI } from '@/core/types/models';

/**
 * Regression coverage for the two model-list fetch paths.
 *
 * Path 1 (REST) only fires for a user-configured ANTHROPIC_API_KEY — a stray
 * OS-level one must not trigger it, since regular chat ignores it too.
 * Path 2 (SDK `supportedModels()`) is what makes subscription (CLI OAuth)
 * users work with zero extra setup: it goes through the same subprocess auth
 * as a normal chat turn, so there is nothing to configure.
 */
describe('fetchModelsFromCLI', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    resetMockMessages();
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
  });

  it('uses the REST API when the user configured an API key', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'claude-opus-5', display_name: 'Claude Opus 5', context_window: 200000 },
        ],
      }),
    }) as unknown as typeof fetch;

    const result = await fetchModelsFromCLI('/usr/bin/claude', 'ANTHROPIC_API_KEY=sk-test-123', '/vault');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'sk-test-123' }) })
    );
    expect(result).toEqual([
      { value: 'claude-opus-5', label: 'Claude Opus 5', description: '컨텍스트 200k 토큰' },
    ]);
  });

  it('ignores a stray OS-level ANTHROPIC_API_KEY the user did not configure', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-stray-system-key';
    global.fetch = jest.fn();
    setMockSupportedModels([
      { value: 'opus', resolvedModel: 'claude-opus-5', displayName: 'Opus', description: 'Opus 5' },
    ]);

    await fetchModelsFromCLI('/usr/bin/claude', '', '/vault');

    // The REST path must not fire off a stray system key — that would be
    // inconsistent with regular chat, which never sees it either.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('falls back to supportedModels() over the SDK when there is no API key', async () => {
    setMockSupportedModels([
      { value: 'default', resolvedModel: 'claude-sonnet-5', displayName: 'Default', description: 'Sonnet 5' },
      { value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet', description: 'Sonnet 5' },
      { value: 'opus', resolvedModel: 'claude-opus-5', displayName: 'Opus', description: 'Opus 5 · Best for complex tasks' },
      { value: 'haiku', resolvedModel: undefined, displayName: 'Haiku', description: 'unresolved' },
    ]);

    const result = await fetchModelsFromCLI('/usr/bin/claude', '', '/vault');

    // 'default' is dropped (not a real model id), the duplicate resolvedModel
    // for 'sonnet' is deduped, and entries with no resolvedModel are skipped.
    expect(result).toEqual([
      { value: 'claude-sonnet-5', label: 'Claude Sonnet 5', description: 'Sonnet 5' },
      { value: 'claude-opus-5', label: 'Claude Opus 5', description: 'Opus 5 · Best for complex tasks' },
    ]);
  });

  it('passes the resolved subprocess env and cwd through to the SDK query', async () => {
    setMockSupportedModels([
      { value: 'opus', resolvedModel: 'claude-opus-5', displayName: 'Opus', description: 'Opus 5' },
    ]);

    await fetchModelsFromCLI('/usr/bin/claude', 'FOO=bar', '/my/vault');

    const options = getLastOptions();
    expect(options?.cwd).toBe('/my/vault');
    expect(options?.pathToClaudeCodeExecutable).toBe('/usr/bin/claude');
    expect((options as any)?.env?.FOO).toBe('bar');
  });

  it('returns null when there is no CLI path and no API key', async () => {
    const result = await fetchModelsFromCLI('', '', '/vault');
    expect(result).toBeNull();
  });

  it('returns null when supportedModels() rejects', async () => {
    setMockSupportedModels(new Error('not logged in'));

    const result = await fetchModelsFromCLI('/usr/bin/claude', '', '/vault');

    expect(result).toBeNull();
  });

  it('returns null when supportedModels() resolves with no usable ids', async () => {
    setMockSupportedModels([
      { value: 'default', resolvedModel: 'claude-sonnet-5', displayName: 'Default', description: '' },
      { value: 'legacy', resolvedModel: undefined, displayName: 'Legacy', description: '' },
    ]);

    const result = await fetchModelsFromCLI('/usr/bin/claude', '', '/vault');

    expect(result).toBeNull();
  });
});
