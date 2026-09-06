import * as fs from 'fs';
import * as os from 'os';

import { createFileHashPostHook, createFileHashPreHook } from '@/core/hooks/DiffTrackingHooks';

describe('DiffTrackingHooks path normalization', () => {
  const vaultPath = '/vault';
  let existsSpy: jest.SpyInstance;
  let statSpy: jest.SpyInstance;
  let readSpy: jest.SpyInstance;

  beforeEach(() => {
    existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    statSpy = jest.spyOn(fs, 'statSync').mockReturnValue({ size: 10 } as any);
    readSpy = jest.spyOn(fs, 'readFileSync').mockReturnValue('original');
  });

  afterEach(() => {
    existsSpy.mockRestore();
    statSpy.mockRestore();
    readSpy.mockRestore();
  });

  it('expands home paths before checking filesystem in pre-hook', async () => {
    const homedirSpy = jest.spyOn(os, 'homedir').mockReturnValue('/home/test');
    const originalContents = new Map();
    const hook = createFileHashPreHook(vaultPath, originalContents);

    await hook.hooks[0](
      {
        hook_event_name: 'PreToolUse',
        session_id: 'test-session',
        transcript_path: '/tmp/transcript',
        cwd: vaultPath,
        tool_name: 'Write',
        tool_input: { file_path: '~/notes/a.md' },
      } as any,
      'tool-1',
      { signal: new AbortController().signal }
    );

    expect(existsSpy).toHaveBeenCalledWith('/home/test/notes/a.md');
    homedirSpy.mockRestore();
  });

  it('expands environment variables before reading filesystem in post-hook', async () => {
    const envKey = 'OBSIDIAN_CODE_DIFF_TEST_PATH';
    const originalValue = process.env[envKey];
    process.env[envKey] = '/tmp/obsidian-code';

    readSpy.mockReturnValue('new');

    const originalContents = new Map();
    originalContents.set('tool-2', { filePath: `$${envKey}/notes/a.md`, content: 'old' });
    const pendingDiffData = new Map();
    const hook = createFileHashPostHook(vaultPath, originalContents, pendingDiffData);

    await hook.hooks[0](
      {
        hook_event_name: 'PostToolUse',
        session_id: 'test-session',
        transcript_path: '/tmp/transcript',
        cwd: vaultPath,
        tool_name: 'Write',
        tool_input: { file_path: `$${envKey}/notes/a.md` },
        tool_result: { is_error: false },
      } as any,
      'tool-2',
      { signal: new AbortController().signal }
    );

    expect(existsSpy).toHaveBeenCalledWith('/tmp/obsidian-code/notes/a.md');
    expect(pendingDiffData.get('tool-2')).toEqual({
      filePath: `$${envKey}/notes/a.md`,
      originalContent: 'old',
      newContent: 'new',
    });

    if (originalValue === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = originalValue;
    }
  });
});

describe('DiffTrackingHooks change sink', () => {
  const vaultPath = '/vault';
  let existsSpy: jest.SpyInstance;
  let statSpy: jest.SpyInstance;
  let readSpy: jest.SpyInstance;

  beforeEach(() => {
    existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    statSpy = jest.spyOn(fs, 'statSync').mockReturnValue({ size: 10 } as any);
    readSpy = jest.spyOn(fs, 'readFileSync').mockReturnValue('new');
  });

  afterEach(() => {
    existsSpy.mockRestore();
    statSpy.mockRestore();
    readSpy.mockRestore();
  });

  function postInput(isError = false) {
    return {
      hook_event_name: 'PostToolUse',
      session_id: 's',
      transcript_path: '/tmp/t',
      cwd: vaultPath,
      tool_name: 'Edit',
      tool_input: { file_path: 'notes/a.md' },
      tool_result: { is_error: isError },
    } as any;
  }

  const options = { signal: new AbortController().signal };

  it('records whether the file existed before the edit', async () => {
    const originalContents = new Map();
    const hook = createFileHashPreHook(vaultPath, originalContents);

    await hook.hooks[0](
      {
        hook_event_name: 'PreToolUse',
        session_id: 's',
        transcript_path: '/tmp/t',
        cwd: vaultPath,
        tool_name: 'Write',
        tool_input: { file_path: 'notes/a.md' },
      } as any,
      'tool-1',
      options
    );
    expect(originalContents.get('tool-1')).toMatchObject({ existed: true });

    existsSpy.mockReturnValue(false);
    await hook.hooks[0](
      {
        hook_event_name: 'PreToolUse',
        session_id: 's',
        transcript_path: '/tmp/t',
        cwd: vaultPath,
        tool_name: 'Write',
        tool_input: { file_path: 'notes/b.md' },
      } as any,
      'tool-2',
      options
    );
    expect(originalContents.get('tool-2')).toMatchObject({ content: '', existed: false });
  });

  it('emits a change entry carrying both sides of the edit', async () => {
    const originalContents = new Map([
      ['tool-1', { filePath: 'notes/a.md', content: 'old', existed: true }],
    ]);
    const onChange = jest.fn();
    const hook = createFileHashPostHook(vaultPath, originalContents, new Map(), undefined, onChange);

    await hook.hooks[0](postInput(), 'tool-1', options);

    expect(onChange).toHaveBeenCalledWith({
      filePath: 'notes/a.md',
      toolName: 'Edit',
      before: 'old',
      after: 'new',
    });
  });

  it('reports a created file as having no prior content', async () => {
    const originalContents = new Map([
      ['tool-1', { filePath: 'notes/a.md', content: '', existed: false }],
    ]);
    const onChange = jest.fn();
    const hook = createFileHashPostHook(vaultPath, originalContents, new Map(), undefined, onChange);

    await hook.hooks[0](postInput(), 'tool-1', options);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ before: null, after: 'new' })
    );
  });

  it('propagates the skip reason when content could not be captured', async () => {
    const originalContents = new Map([
      ['tool-1', { filePath: 'notes/a.md', content: null, skippedReason: 'too_large' as const }],
    ]);
    const onChange = jest.fn();
    const hook = createFileHashPostHook(vaultPath, originalContents, new Map(), undefined, onChange);

    await hook.hooks[0](postInput(), 'tool-1', options);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ before: null, after: null, skippedReason: 'too_large' })
    );
  });

  it('emits nothing when the tool call failed', async () => {
    const originalContents = new Map([
      ['tool-1', { filePath: 'notes/a.md', content: 'old', existed: true }],
    ]);
    const onChange = jest.fn();
    const hook = createFileHashPostHook(vaultPath, originalContents, new Map(), undefined, onChange);

    await hook.hooks[0](postInput(true), 'tool-1', options);

    expect(onChange).not.toHaveBeenCalled();
  });
});
