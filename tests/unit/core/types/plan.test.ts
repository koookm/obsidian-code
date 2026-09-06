import {
  createPlanFromMarkdown,
  extractPlanTargets,
  extractPlanTitle,
  parsePlanMarkdown,
} from '@/core/types/plan';

describe('extractPlanTitle', () => {
  it('uses the first markdown heading', () => {
    expect(extractPlanTitle('# Refactor the inbox\n\nbody')).toBe('Refactor the inbox');
  });

  it('skips YAML frontmatter before looking for a heading', () => {
    const md = '---\nstatus: draft\n# not a heading\n---\n\n## Real title\n';
    expect(extractPlanTitle(md)).toBe('Real title');
  });

  it('falls back to the first non-empty line when there is no heading', () => {
    expect(extractPlanTitle('\n\nMove daily notes into Journal/\nmore text')).toBe(
      'Move daily notes into Journal/'
    );
  });

  it('returns an empty string for blank input', () => {
    expect(extractPlanTitle('   \n\n  ')).toBe('');
  });

  it('truncates very long titles', () => {
    const title = extractPlanTitle(`# ${'a'.repeat(300)}`);
    expect(title.length).toBeLessThanOrEqual(120);
  });
});

describe('extractPlanTargets', () => {
  it('collects path-like inline code spans', () => {
    const md = 'Edit `src/core/foo.ts` and `README.md`.';
    expect(extractPlanTargets(md)).toEqual(['src/core/foo.ts', 'README.md']);
  });

  it('ignores shell commands and flags in code spans', () => {
    const md = 'Run `npm run build` with `--force` then edit `docs/a.md`.';
    expect(extractPlanTargets(md)).toEqual(['docs/a.md']);
  });

  it('collects wikilink targets and strips headings, blocks and aliases', () => {
    const md = 'See [[Journal/2026-01-01#Morning]] and [[Inbox/Note^abc]] and [[Ideas|my ideas]].';
    expect(extractPlanTargets(md)).toEqual([
      'Journal/2026-01-01',
      'Inbox/Note',
      'Ideas',
    ]);
  });

  it('normalizes backslashes and dedupes while preserving order', () => {
    const md = 'Edit `src\\a.ts`, then `src/a.ts`, then `src/b.ts`.';
    expect(extractPlanTargets(md)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('ignores fenced code blocks', () => {
    const md = '```\nsrc/should-not-appear.ts\n```\nEdit `src/real.ts`.';
    expect(extractPlanTargets(md)).toEqual(['src/real.ts']);
  });

  it('returns an empty array when nothing looks like a path', () => {
    expect(extractPlanTargets('Just prose, no paths.')).toEqual([]);
  });
});

describe('parsePlanMarkdown', () => {
  it('returns both the title and the targets', () => {
    const md = '# Tidy Inbox\n\nMove `Inbox/a.md` into [[Archive]].';
    expect(parsePlanMarkdown(md)).toEqual({
      title: 'Tidy Inbox',
      targets: ['Inbox/a.md', 'Archive'],
    });
  });
});

describe('createPlanFromMarkdown', () => {
  it('builds a draft plan carrying the markdown as rationale', () => {
    const md = '# Tidy Inbox\n\nMove `Inbox/a.md`.';
    const plan = createPlanFromMarkdown(md, { id: 'plan-1', now: 1000 });

    expect(plan).toMatchObject({
      id: 'plan-1',
      title: 'Tidy Inbox',
      kind: 'custom',
      targets: ['Inbox/a.md'],
      rationale: md,
      constraints: [],
      postconditions: [],
      status: 'draft',
      createdAt: 1000,
    });
  });

  it('lets the caller override kind, constraints and postconditions', () => {
    const plan = createPlanFromMarkdown('# T', {
      id: 'p',
      now: 1,
      kind: 'refactor',
      constraints: [{ id: 'maintenance-window' }],
      postconditions: [{ id: 'link-integrity' }],
    });

    expect(plan.kind).toBe('refactor');
    expect(plan.constraints).toEqual([{ id: 'maintenance-window' }]);
    expect(plan.postconditions).toEqual([{ id: 'link-integrity' }]);
  });

  it('falls back to an untitled plan when the markdown is blank', () => {
    expect(createPlanFromMarkdown('   ', { id: 'p', now: 1 }).title).toBe('Untitled plan');
  });
});
