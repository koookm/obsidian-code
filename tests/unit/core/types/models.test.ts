import { DEFAULT_CLAUDE_MODELS, DEFAULT_MODEL, DEFAULT_THINKING_BUDGET } from '@/core/types/models';

describe('DEFAULT_CLAUDE_MODELS', () => {
  it('excludes models below 4.6', () => {
    const ids = DEFAULT_CLAUDE_MODELS.map(m => m.value);
    expect(ids).not.toContain('claude-haiku-4-5');
    expect(ids).not.toContain('claude-sonnet-4-5');
    expect(ids).not.toContain('claude-opus-4-5');
    expect(ids).not.toContain('claude-opus-4-6');
  });

  it('excludes superseded claude-opus-4-7', () => {
    const ids = DEFAULT_CLAUDE_MODELS.map(m => m.value);
    expect(ids).not.toContain('claude-opus-4-7');
  });

  it('includes claude-fable-5, claude-opus-4-8 and claude-sonnet-4-6', () => {
    const ids = DEFAULT_CLAUDE_MODELS.map(m => m.value);
    expect(ids).toContain('claude-fable-5');
    expect(ids).toContain('claude-opus-4-8');
    expect(ids).toContain('claude-sonnet-4-6');
  });

  it('preserves CLI aliases fable, haiku, sonnet, opus', () => {
    const ids = DEFAULT_CLAUDE_MODELS.map(m => m.value);
    expect(ids).toContain('fable');
    expect(ids).toContain('haiku');
    expect(ids).toContain('sonnet');
    expect(ids).toContain('opus');
  });
});

describe('DEFAULT_MODEL', () => {
  it('defaults to the latest Fable CLI alias', () => {
    expect(DEFAULT_MODEL).toBe('fable');
  });

  it('is included in DEFAULT_CLAUDE_MODELS', () => {
    const ids = DEFAULT_CLAUDE_MODELS.map(m => m.value);
    expect(ids).toContain(DEFAULT_MODEL);
  });
});

describe('DEFAULT_THINKING_BUDGET', () => {
  it('excludes removed model versions', () => {
    expect(DEFAULT_THINKING_BUDGET['claude-opus-4-6']).toBeUndefined();
    expect(DEFAULT_THINKING_BUDGET['claude-haiku-4-5']).toBeUndefined();
    expect(DEFAULT_THINKING_BUDGET['claude-sonnet-4-5']).toBeUndefined();
    expect(DEFAULT_THINKING_BUDGET['claude-opus-4-5']).toBeUndefined();
  });

  it('includes current model versions and CLI aliases', () => {
    expect(DEFAULT_THINKING_BUDGET['claude-fable-5']).toBe('medium');
    expect(DEFAULT_THINKING_BUDGET['claude-opus-4-8']).toBe('medium');
    expect(DEFAULT_THINKING_BUDGET['claude-opus-4-7']).toBe('medium');  // legacy saved settings
    expect(DEFAULT_THINKING_BUDGET['claude-sonnet-4-6']).toBe('low');
    expect(DEFAULT_THINKING_BUDGET['fable']).toBe('medium');
    expect(DEFAULT_THINKING_BUDGET['haiku']).toBe('off');
    expect(DEFAULT_THINKING_BUDGET['sonnet']).toBe('low');
    expect(DEFAULT_THINKING_BUDGET['opus']).toBe('medium');
  });
});
