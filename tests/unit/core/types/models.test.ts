import { readFileSync } from 'fs';
import { join } from 'path';

import { buildModelCatalog } from '@/core/models/ModelCatalog';
import {
  DEFAULT_CLAUDE_MODELS,
  DEFAULT_MODEL,
  FAMILY_THINKING_BUDGET,
  getDefaultThinkingBudget,
} from '@/core/types/models';

// Behaviour of the fetch itself lives in fetchModelsFromCLI.test.ts. This is a
// source-level guard against re-introducing the specific broken call.
//
// Regression: the model refresh used to shell out to `claude api get
// /v1/models`, but the CLI has no `api` subcommand — those words were parsed as
// a *prompt*, so every refresh silently ran a billable inference query whose
// prose output could never parse as JSON. The model list is now read through
// the Agent SDK's supportedModels() control request instead, which is why an
// SDK-owned subprocess is expected here but a direct child_process call is not.
//
// Asserted against the module source rather than with a child_process spy: the
// old code bound promisify(execFile) at module load, so a spy installed later
// would never have seen the call.
describe('models module', () => {
  const source = readFileSync(
    join(__dirname, '../../../../src/core/types/models.ts'),
    'utf8',
  );

  it('never shells out to the Claude CLI directly', () => {
    expect(source).not.toMatch(/child_process/);
    expect(source).not.toMatch(/execFile|execSync/);
  });

  it('never asks the CLI for a nonexistent `api` subcommand', () => {
    expect(source).not.toMatch(/'api',\s*'get'/);
    expect(source).not.toMatch(/api get \/v1\/models/);
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
