/**
 * Pure wikilink parsing and resolution for health probes.
 *
 * The rendering path in `utils/fileLink.ts` resolves links through Obsidian's
 * metadata cache; probes cannot, because they run over a snapshot and must
 * stay free of Obsidian imports to remain testable. This module reimplements
 * the resolution rules the probes need.
 */

/** A wikilink found in a note. */
export interface ParsedLink {
  /** Target with alias, heading and block reference stripped. */
  target: string;
  /** True for `![[...]]` embeds. */
  embed: boolean;
  /** 1-indexed line the link appears on. */
  line: number;
}

/** Lookup tables for resolving a link target to a real vault path. */
export interface FileIndex {
  /** Lowercased full path, with extension. */
  byPath: Map<string, string>;
  /** Lowercased full path, extension removed. */
  byPathNoExt: Map<string, string>;
  /** Lowercased file name, with extension. */
  byName: Map<string, string>;
  /** Lowercased file name, extension removed. */
  byNameNoExt: Map<string, string>;
}

/** Options for {@link resolveLink}. */
export interface ResolveOptions {
  /** Folders to also try as a prefix, for targets written relative to them. */
  extraFolders?: string[];
}

const LINK_PATTERN = /(!?)\[\[([^\]\n]+)\]\]/g;
const FENCE_PATTERN = /^[ \t]*(`{3,}|~{3,})/;
const INLINE_CODE_PATTERN = /`[^`\n]+`/g;

function blank(value: string): string {
  return ' '.repeat(value.length);
}

/**
 * Replaces code spans and fenced blocks with spaces, keeping every character
 * offset and line break intact so reported line numbers stay accurate.
 */
export function maskCode(content: string): string {
  let openFence: string | null = null;

  return content
    .split('\n')
    .map((line) => {
      const fence = line.match(FENCE_PATTERN);

      if (openFence) {
        if (fence && fence[1][0] === openFence[0] && fence[1].length >= openFence.length) {
          openFence = null;
        }
        return blank(line);
      }

      if (fence) {
        openFence = fence[1];
        return blank(line);
      }

      return line.replace(INLINE_CODE_PATTERN, blank);
    })
    .join('\n');
}

/** Strips an alias, heading or block reference and normalizes separators. */
function cleanTarget(inner: string): string {
  const withoutAlias = inner.split('|')[0];
  const withoutHeading = withoutAlias.split('#')[0];
  const withoutBlock = withoutHeading.split('^')[0];
  return withoutBlock.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

/** Offsets of each line start, for turning an index into a line number. */
function lineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineOf(starts: number[], index: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (starts[mid] <= index) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/**
 * Finds every wikilink outside code. Same-note links such as `[[#Heading]]`
 * carry no file target and are skipped.
 */
export function parseLinks(content: string): ParsedLink[] {
  const masked = maskCode(content);
  const starts = lineStarts(masked);
  const links: ParsedLink[] = [];

  LINK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINK_PATTERN.exec(masked)) !== null) {
    const target = cleanTarget(match[2]);
    if (!target) continue;
    links.push({ target, embed: match[1] === '!', line: lineOf(starts, match.index) });
  }

  return links;
}

function stripExtension(value: string): string {
  const dot = value.lastIndexOf('.');
  const slash = value.lastIndexOf('/');
  return dot > slash + 1 ? value.slice(0, dot) : value;
}

/** Builds resolution tables from every path in the vault, attachments included. */
export function buildFileIndex(paths: string[]): FileIndex {
  const index: FileIndex = {
    byPath: new Map(),
    byPathNoExt: new Map(),
    byName: new Map(),
    byNameNoExt: new Map(),
  };

  for (const path of paths) {
    const lower = path.toLowerCase();
    const name = lower.slice(lower.lastIndexOf('/') + 1);

    setOnce(index.byPath, lower, path);
    setOnce(index.byPathNoExt, stripExtension(lower), path);
    setOnce(index.byName, name, path);
    setOnce(index.byNameNoExt, stripExtension(name), path);
  }

  return index;
}

/** First path wins, so resolution is deterministic for duplicate names. */
function setOnce(map: Map<string, string>, key: string, value: string): void {
  if (key && !map.has(key)) map.set(key, value);
}

/**
 * Resolves a link target to a vault path, or null when nothing matches.
 *
 * Mirrors Obsidian: a target containing a separator is matched as a path, and
 * a bare name may match a file anywhere in the vault.
 */
export function resolveLink(
  target: string,
  index: FileIndex,
  options: ResolveOptions = {}
): string | null {
  const key = target.toLowerCase();

  const direct = index.byPath.get(key) ?? index.byPathNoExt.get(key);
  if (direct) return direct;

  if (!target.includes('/')) {
    const byName = index.byName.get(key) ?? index.byNameNoExt.get(key);
    if (byName) return byName;
  }

  for (const folder of options.extraFolders ?? []) {
    if (!folder) continue;
    const prefixed = `${folder.toLowerCase().replace(/\/$/, '')}/${key}`;
    const hit = index.byPath.get(prefixed) ?? index.byPathNoExt.get(prefixed);
    if (hit) return hit;
  }

  return null;
}

/** Markdown files carrying text are the only ones a link probe can scan. */
export function isScannableNote(file: { path: string; content?: string }): boolean {
  return file.content !== undefined && file.path.toLowerCase().endsWith('.md');
}
