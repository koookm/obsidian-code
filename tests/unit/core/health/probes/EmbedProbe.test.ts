import { EmbedProbe } from '@/core/health/probes/EmbedProbe';
import type { VaultSnapshot } from '@/core/health/types';

function snapshot(files: { path: string; content?: string }[]): VaultSnapshot {
  return { files };
}

describe('EmbedProbe', () => {
  it('resolves an embed against the vault', () => {
    const result = new EmbedProbe().run(
      snapshot([
        { path: 'a.md', content: '![[photo.png]]' },
        { path: 'attachments/photo.png' },
      ])
    );

    expect(result).toMatchObject({ probeId: 'embed-integrity', status: 'healthy' });
  });

  it('reports a missing embed target', () => {
    const result = new EmbedProbe().run(snapshot([{ path: 'a.md', content: '![[gone.png]]' }]));

    expect(result.status).toBe('degraded');
    expect(result.findings).toEqual([
      { path: 'a.md', line: 1, target: 'gone.png', message: 'Unresolved embed: ![[gone.png]]' },
    ]);
  });

  it('searches the configured media folder', () => {
    // The subpath keeps basename resolution from making this pass for free.
    const files = [
      { path: 'a.md', content: '![[sub/photo.png]]' },
      { path: 'media/sub/photo.png' },
    ];

    expect(new EmbedProbe().run(snapshot(files)).findings).toHaveLength(1);
    expect(new EmbedProbe({ mediaFolder: 'media' }).run(snapshot(files)).findings).toEqual([]);
  });

  it('resolves an embedded note by appending .md', () => {
    const result = new EmbedProbe().run(
      snapshot([
        { path: 'a.md', content: '![[Shared/Boilerplate]]' },
        { path: 'Shared/Boilerplate.md' },
      ])
    );
    expect(result.findings).toEqual([]);
  });

  it('ignores plain links', () => {
    const result = new EmbedProbe().run(snapshot([{ path: 'a.md', content: '[[missing]]' }]));
    expect(result.findings).toEqual([]);
  });
});
