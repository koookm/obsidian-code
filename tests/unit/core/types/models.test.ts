import { DEFAULT_CLAUDE_MODELS } from '@/core/types/models';

describe('DEFAULT_CLAUDE_MODELS', () => {
  it('excludes models below 4.6', () => {
    const ids = DEFAULT_CLAUDE_MODELS.map(m => m.value);
    expect(ids).not.toContain('claude-haiku-4-5');
    expect(ids).not.toContain('claude-sonnet-4-5');
    expect(ids).not.toContain('claude-opus-4-5');
    expect(ids).not.toContain('claude-opus-4-6');
  });

  it('includes claude-sonnet-4-6 and claude-opus-4-7', () => {
    const ids = DEFAULT_CLAUDE_MODELS.map(m => m.value);
    expect(ids).toContain('claude-sonnet-4-6');
    expect(ids).toContain('claude-opus-4-7');
  });
});
