import {
  extractFrontmatterKeys,
  FrontmatterSchemaProbe,
} from '@/core/health/probes/FrontmatterSchemaProbe';
import type { VaultSnapshot } from '@/core/health/types';

function snapshot(files: { path: string; content?: string }[]): VaultSnapshot {
  return { files };
}

describe('extractFrontmatterKeys', () => {
  it('returns top-level keys', () => {
    expect(extractFrontmatterKeys('---\ntitle: A\ntags:\n  - x\n---\nbody')).toEqual([
      'title',
      'tags',
    ]);
  });

  it('ignores nested keys and list items', () => {
    expect(extractFrontmatterKeys('---\nmeta:\n  nested: 1\n  - item\n---\n')).toEqual(['meta']);
  });

  it('returns null when there is no frontmatter', () => {
    expect(extractFrontmatterKeys('# Heading\n')).toBeNull();
  });

  it('returns an empty list for an empty block', () => {
    expect(extractFrontmatterKeys('---\n\n---\nbody')).toEqual([]);
  });
});

describe('FrontmatterSchemaProbe', () => {
  const rules = [{ pathPrefix: 'Journal/', required: ['date', 'tags'] }];

  it('passes when required fields are present', () => {
    const result = new FrontmatterSchemaProbe({ rules }).run(
      snapshot([{ path: 'Journal/a.md', content: '---\ndate: 2026-01-01\ntags: []\n---\n' }])
    );

    expect(result).toMatchObject({ probeId: 'frontmatter-schema', status: 'healthy' });
  });

  it('reports each missing field', () => {
    const result = new FrontmatterSchemaProbe({ rules }).run(
      snapshot([{ path: 'Journal/a.md', content: '---\ndate: 2026-01-01\n---\n' }])
    );

    expect(result.findings).toEqual([
      { path: 'Journal/a.md', message: 'Missing frontmatter field: tags' },
    ]);
  });

  it('reports a note with no frontmatter at all', () => {
    const result = new FrontmatterSchemaProbe({ rules }).run(
      snapshot([{ path: 'Journal/a.md', content: '# no frontmatter' }])
    );

    expect(result.findings).toEqual([
      { path: 'Journal/a.md', message: 'Missing frontmatter block' },
    ]);
  });

  it('only checks files matching the rule prefix', () => {
    const result = new FrontmatterSchemaProbe({ rules }).run(
      snapshot([{ path: 'Inbox/a.md', content: '# nothing' }])
    );

    expect(result.filesChecked).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it('applies every matching rule', () => {
    const result = new FrontmatterSchemaProbe({
      rules: [
        { pathPrefix: '', required: ['title'] },
        { pathPrefix: 'Journal/', required: ['date'] },
      ],
    }).run(snapshot([{ path: 'Journal/a.md', content: '---\nx: 1\n---\n' }]));

    expect(result.findings.map((f) => f.message)).toEqual([
      'Missing frontmatter field: title',
      'Missing frontmatter field: date',
    ]);
  });
});
