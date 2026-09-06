import { LinkIntegrityProbe } from '@/core/health/probes/LinkIntegrityProbe';
import type { VaultSnapshot } from '@/core/health/types';

function snapshot(files: { path: string; content?: string }[]): VaultSnapshot {
  return { files };
}

describe('LinkIntegrityProbe', () => {
  it('reports healthy when every link resolves', () => {
    const result = new LinkIntegrityProbe().run(
      snapshot([
        { path: 'a.md', content: 'see [[b]]' },
        { path: 'b.md', content: '' },
      ])
    );

    expect(result).toMatchObject({ probeId: 'link-integrity', status: 'healthy', filesChecked: 2 });
    expect(result.findings).toEqual([]);
  });

  it('reports a broken link with its file, line and target', () => {
    const result = new LinkIntegrityProbe().run(
      snapshot([{ path: 'a.md', content: 'intro\nsee [[missing]]' }])
    );

    expect(result.status).toBe('degraded');
    expect(result.findings).toEqual([
      { path: 'a.md', line: 2, target: 'missing', message: 'Unresolved link: [[missing]]' },
    ]);
  });

  it('ignores embeds, which the embed probe owns', () => {
    const result = new LinkIntegrityProbe().run(
      snapshot([{ path: 'a.md', content: '![[missing.png]]' }])
    );
    expect(result.findings).toEqual([]);
  });

  it('only scans markdown files that carry content', () => {
    const result = new LinkIntegrityProbe().run(
      snapshot([
        { path: 'a.md', content: '[[missing]]' },
        { path: 'photo.png' },
        { path: 'notes.txt', content: '[[missing]]' },
      ])
    );

    expect(result.filesChecked).toBe(1);
    expect(result.findings).toHaveLength(1);
  });

  it('resolves links against attachments as well as notes', () => {
    const result = new LinkIntegrityProbe().run(
      snapshot([
        { path: 'a.md', content: '[[attachments/photo.png]]' },
        { path: 'attachments/photo.png' },
      ])
    );
    expect(result.findings).toEqual([]);
  });

  it('escalates to failed when configured to', () => {
    const result = new LinkIntegrityProbe({ severity: 'failed' }).run(
      snapshot([{ path: 'a.md', content: '[[missing]]' }])
    );
    expect(result.status).toBe('failed');
  });
});
