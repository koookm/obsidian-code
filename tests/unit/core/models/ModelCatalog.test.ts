import {
  buildModelCatalog,
  findCatalogEntry,
  formatModelLabel,
  formatModelShortLabel,
  isClaudeModelId,
  isPlausibleModelId,
  parseModelId,
  resolveModelCatalog,
} from '@/core/models/ModelCatalog';

const FALLBACK = [
  { value: 'claude-fable-5', label: 'Claude Fable 5', description: '' },
  { value: 'claude-opus-5', label: 'Claude Opus 5', description: '' },
  { value: 'claude-opus-4-8', label: 'Claude Opus 4.8', description: '' },
  { value: 'claude-sonnet-5', label: 'Claude Sonnet 5', description: '' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: '' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', description: '' },
];

describe('parseModelId', () => {
  it('parses modern ids into family and version', () => {
    expect(parseModelId('claude-opus-4-8')).toEqual({ family: 'opus', version: [4, 8], date: null });
    expect(parseModelId('claude-opus-5')).toEqual({ family: 'opus', version: [5], date: null });
    expect(parseModelId('claude-fable-5')).toEqual({ family: 'fable', version: [5], date: null });
  });

  it('separates a trailing release date from the version', () => {
    expect(parseModelId('claude-haiku-4-5-20251001')).toEqual({
      family: 'haiku',
      version: [4, 5],
      date: '20251001',
    });
  });

  it('parses legacy ids where the version precedes the family', () => {
    expect(parseModelId('claude-3-5-sonnet-20241022')).toEqual({
      family: 'sonnet',
      version: [3, 5],
      date: '20241022',
    });
  });

  it('parses bare CLI aliases', () => {
    expect(parseModelId('opus')).toEqual({ family: 'opus', version: [], date: null });
  });

  it('strips provider and region qualifiers', () => {
    expect(parseModelId('us.anthropic.claude-opus-4-5-v1:0').family).toBe('opus');
    expect(parseModelId('bedrock/claude-sonnet-4-6').family).toBe('sonnet');
  });

  it('returns an empty family for ids without one', () => {
    expect(parseModelId('claude-2.1').family).toBe('');
  });
});

describe('formatModelLabel', () => {
  it('renders a dotted version', () => {
    expect(formatModelLabel('claude-opus-4-8')).toBe('Claude Opus 4.8');
    expect(formatModelLabel('claude-fable-5')).toBe('Claude Fable 5');
  });

  it('has a compact form without the vendor prefix for menu rows', () => {
    expect(formatModelShortLabel('claude-opus-4-8')).toBe('Opus 4.8');
    expect(formatModelShortLabel('claude-haiku-4-5')).toBe('Haiku 4.5');
    expect(formatModelShortLabel('claude-2.1')).toBe('claude-2.1');
  });

  it('falls back to the raw id when there is no family', () => {
    expect(formatModelLabel('claude-2.1')).toBe('claude-2.1');
  });
});

describe('buildModelCatalog', () => {
  it('exposes one CLI alias per family in the latest tier', () => {
    const catalog = buildModelCatalog(FALLBACK);
    expect(catalog.latest.map((m) => m.value)).toEqual(['fable', 'opus', 'sonnet', 'haiku']);
    expect(catalog.latest.every((m) => m.isAlias)).toBe(true);
  });

  it('resolves each alias to the newest pinned id of its family', () => {
    const catalog = buildModelCatalog(FALLBACK);
    const opus = catalog.latest.find((m) => m.value === 'opus');
    expect(opus?.resolvedId).toBe('claude-opus-5');
    // The row is named after the version it resolves to, Claude Code style.
    expect(opus?.label).toBe('Opus 5');
    expect(opus?.description).toContain('claude-opus-5');
  });

  it('renames the alias row when a newer version ships', () => {
    const catalog = buildModelCatalog([
      ...FALLBACK,
      { value: 'claude-opus-6', label: 'Claude Opus 6', description: '' },
    ]);
    expect(catalog.latest.find((m) => m.value === 'opus')?.label).toBe('Opus 6');
  });

  it('picks up a newly released version with no code change', () => {
    const catalog = buildModelCatalog([
      ...FALLBACK,
      { value: 'claude-opus-6', label: 'Claude Opus 6', description: '' },
    ]);
    expect(catalog.latest.find((m) => m.value === 'opus')?.resolvedId).toBe('claude-opus-6');
    expect(catalog.previous.map((m) => m.value)).toContain('claude-opus-6');
  });

  it('surfaces an unknown new family as its own latest entry', () => {
    const catalog = buildModelCatalog([
      ...FALLBACK,
      { value: 'claude-lyric-1', label: 'Claude Lyric 1', description: '' },
    ]);
    const lyric = catalog.latest.find((m) => m.family === 'lyric');
    expect(lyric?.value).toBe('claude-lyric-1');
    expect(lyric?.isAlias).toBe(false);
  });

  it('limits the previous tier to the current and immediately previous version', () => {
    const catalog = buildModelCatalog([
      ...FALLBACK,
      { value: 'claude-opus-4-7', label: 'Claude Opus 4.7', description: '' },
      { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', description: '' },
    ]);
    const opusPinned = catalog.previous.filter((m) => m.family === 'opus').map((m) => m.value);
    expect(opusPinned).toEqual(['claude-opus-5', 'claude-opus-4-8']);
  });

  it('collapses dated and undated ids of the same version', () => {
    const catalog = buildModelCatalog([
      { value: 'claude-opus-5', label: 'Claude Opus 5', description: '' },
      { value: 'claude-opus-5-20260101', label: 'Claude Opus 5', description: '' },
    ]);
    expect(catalog.previous.map((m) => m.value)).toEqual(['claude-opus-5']);
  });

  it('ignores bare aliases in the source list', () => {
    const catalog = buildModelCatalog([...FALLBACK, { value: 'opus', label: 'Opus', description: '' }]);
    expect(catalog.previous.some((m) => m.value === 'opus')).toBe(false);
  });
});

describe('resolveModelCatalog', () => {
  it('prefers the fetched list over the offline fallback', () => {
    const catalog = resolveModelCatalog({
      runtimeModels: [{ value: 'claude-opus-9', label: 'Claude Opus 9', description: '' }],
      fallbackModels: FALLBACK,
    });
    expect(catalog.source).toBe('api');
    expect(catalog.latest.find((m) => m.value === 'opus')?.resolvedId).toBe('claude-opus-9');
  });

  it('falls back to the bundled list when nothing was fetched', () => {
    const catalog = resolveModelCatalog({ runtimeModels: null, fallbackModels: FALLBACK });
    expect(catalog.source).toBe('default');
    expect(catalog.latest.map((m) => m.value)).toContain('fable');
  });

  it('uses env models verbatim for a custom endpoint', () => {
    const catalog = resolveModelCatalog({
      runtimeModels: null,
      envText: 'ANTHROPIC_BASE_URL=https://proxy.example.com\nANTHROPIC_MODEL=my-custom-model',
      fallbackModels: FALLBACK,
    });
    expect(catalog.source).toBe('env');
    expect(catalog.latest.map((m) => m.value)).toEqual(['my-custom-model']);
    expect(catalog.previous).toEqual([]);
  });

  it('appends env models to the previous tier when the endpoint is Anthropic', () => {
    const catalog = resolveModelCatalog({
      runtimeModels: null,
      envText: 'ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-9',
      fallbackModels: FALLBACK,
    });
    expect(catalog.latest.map((m) => m.value)).toContain('fable');
    expect(catalog.previous.map((m) => m.value)).toContain('claude-haiku-9');
  });
});

describe('findCatalogEntry', () => {
  const catalog = buildModelCatalog(FALLBACK);

  it('finds a known entry', () => {
    expect(findCatalogEntry(catalog, 'opus').label).toBe('Opus 5');
  });

  it('synthesizes an entry for an unknown id instead of guessing another model', () => {
    expect(findCatalogEntry(catalog, 'claude-opus-42').value).toBe('claude-opus-42');
    expect(findCatalogEntry(catalog, 'claude-opus-42').label).toBe('Opus 42');
  });
});

describe('isPlausibleModelId', () => {
  it('accepts real and future model ids', () => {
    expect(isPlausibleModelId('claude-opus-5')).toBe(true);
    expect(isPlausibleModelId('claude-something-12')).toBe(true);
    expect(isPlausibleModelId('us.anthropic.claude-opus-4-5-v1:0')).toBe(true);
  });

  it('rejects stray text', () => {
    expect(isPlausibleModelId('')).toBe(false);
    expect(isPlausibleModelId('claude-2.1')).toBe(false);
    expect(isPlausibleModelId('some model name')).toBe(false);
  });
});

describe('isClaudeModelId', () => {
  it('recognizes first-party ids and aliases', () => {
    expect(isClaudeModelId('claude-opus-5')).toBe(true);
    expect(isClaudeModelId('fable')).toBe(true);
  });

  it('rejects third-party ids', () => {
    expect(isClaudeModelId('gpt-4o')).toBe(false);
    expect(isClaudeModelId('bedrock/claude-opus-5')).toBe(false);
  });
});
