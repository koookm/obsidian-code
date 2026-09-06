import { buildFileIndex, maskCode, parseLinks, resolveLink } from '@/core/health/linkParser';

describe('maskCode', () => {
  it('blanks fenced blocks while preserving line positions', () => {
    const masked = maskCode('a\n```\n[[hidden]]\n```\nb');
    expect(masked.split('\n')).toHaveLength(5);
    expect(masked).not.toContain('[[hidden]]');
    expect(masked).toContain('a');
    expect(masked).toContain('b');
  });

  it('blanks inline code spans', () => {
    expect(maskCode('see `[[hidden]]` here')).not.toContain('[[hidden]]');
  });

  it('leaves ordinary text untouched', () => {
    expect(maskCode('plain [[link]] text')).toBe('plain [[link]] text');
  });

  it('handles tilde fences', () => {
    expect(maskCode('~~~\n[[hidden]]\n~~~')).not.toContain('[[hidden]]');
  });
});

describe('parseLinks', () => {
  it('finds plain links with 1-indexed line numbers', () => {
    const links = parseLinks('intro\n\nsee [[Note]] here');
    expect(links).toEqual([{ target: 'Note', embed: false, line: 3 }]);
  });

  it('distinguishes embeds from plain links', () => {
    const links = parseLinks('[[A]] and ![[B.png]]');
    expect(links).toEqual([
      { target: 'A', embed: false, line: 1 },
      { target: 'B.png', embed: true, line: 1 },
    ]);
  });

  it('strips aliases, headings and block references', () => {
    const links = parseLinks('[[A|alias]] [[B#Head]] [[C^blk]]');
    expect(links.map((l) => l.target)).toEqual(['A', 'B', 'C']);
  });

  it('normalizes separators and leading ./', () => {
    expect(parseLinks('[[.\\folder\\Note]]')[0].target).toBe('folder/Note');
  });

  it('ignores same-note heading links', () => {
    expect(parseLinks('[[#Heading]] and [[^block]]')).toEqual([]);
  });

  it('ignores links inside code', () => {
    expect(parseLinks('```\n[[hidden]]\n```\n`[[also]]`')).toEqual([]);
  });
});

describe('resolveLink', () => {
  const index = buildFileIndex([
    'Journal/2026-01-01.md',
    'Inbox/Idea.md',
    'attachments/photo.png',
    'Archive/Idea.md',
  ]);

  it('resolves a full path without an extension', () => {
    expect(resolveLink('Journal/2026-01-01', index)).toBe('Journal/2026-01-01.md');
  });

  it('resolves a full path with an extension', () => {
    expect(resolveLink('attachments/photo.png', index)).toBe('attachments/photo.png');
  });

  it('resolves a bare basename anywhere in the vault', () => {
    expect(resolveLink('2026-01-01', index)).toBe('Journal/2026-01-01.md');
  });

  it('resolves a bare filename with an extension', () => {
    expect(resolveLink('photo.png', index)).toBe('attachments/photo.png');
  });

  it('is case-insensitive', () => {
    expect(resolveLink('inbox/idea', index)).toBe('Inbox/Idea.md');
  });

  it('returns null for an unknown target', () => {
    expect(resolveLink('Nope', index)).toBeNull();
  });

  it('does not resolve a bare name as a path in another folder', () => {
    expect(resolveLink('Journal/Idea', index)).toBeNull();
  });

  it('searches an extra folder when one is given', () => {
    // A bare filename already resolves by basename, so the target carries a
    // subpath to prove the extra folder is what resolved it.
    const media = buildFileIndex(['media/sub/photo.png']);
    expect(resolveLink('sub/photo.png', media)).toBeNull();
    expect(resolveLink('sub/photo.png', media, { extraFolders: ['media'] })).toBe(
      'media/sub/photo.png'
    );
  });
});
