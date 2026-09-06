/**
 * Plan type definitions.
 *
 * Promotes Plan Mode's markdown output into a typed, serializable object.
 * A plan that is only prose can be read by a human but not gated by a
 * constraint or verified by a probe; giving it a shape is what lets the
 * rest of the orchestration layer reason about it.
 *
 * Pure module — no Obsidian or SDK imports, so it stays testable in isolation.
 */

/** Broad category of work a plan performs. */
export type PlanKind = 'edit' | 'create' | 'refactor' | 'index' | 'custom';

/** Lifecycle state of a plan. */
export type PlanStatus =
  | 'draft'
  | 'approved'
  | 'executing'
  | 'completed'
  | 'reverted'
  | 'failed';

/** Reference to a constraint that must be satisfied before the plan runs. */
export interface ConstraintRef {
  id: string;
  params?: Record<string, unknown>;
}

/** Reference to a probe that must pass after the plan runs. */
export interface ProbeRef {
  id: string;
  params?: Record<string, unknown>;
}

/** A unit of work against the vault. */
export interface VaultPlan {
  id: string;
  title: string;
  kind: PlanKind;
  /** Vault-relative paths the plan expects to touch. */
  targets: string[];
  /** The original plan prose, kept verbatim for display and audit. */
  rationale: string;
  constraints: ConstraintRef[];
  postconditions: ProbeRef[];
  status: PlanStatus;
  createdAt: number;
}

/** Options for building a plan from markdown. */
export interface CreatePlanOptions {
  id: string;
  now: number;
  kind?: PlanKind;
  /** Overrides the targets extracted from the markdown. */
  targets?: string[];
  constraints?: ConstraintRef[];
  postconditions?: ProbeRef[];
}

/** Longest title we keep; plan prose sometimes opens with a paragraph. */
const MAX_TITLE_LENGTH = 120;

const FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
const FENCED_BLOCK_PATTERN = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm;
const INLINE_CODE_PATTERN = /`([^`\n]+)`/g;
const WIKILINK_PATTERN = /!?\[\[([^\]\n]+)\]\]/g;

/** Removes a leading YAML frontmatter block, if present. */
function stripFrontmatter(markdown: string): string {
  return markdown.replace(FRONTMATTER_PATTERN, '');
}

/** Blanks out fenced code blocks so their contents are never read as content. */
function stripFencedBlocks(markdown: string): string {
  return markdown.replace(FENCED_BLOCK_PATTERN, '');
}

/**
 * Extracts a plan title: the first markdown heading, else the first non-empty
 * line. Returns an empty string when the markdown carries neither.
 */
export function extractPlanTitle(markdown: string): string {
  const body = stripFrontmatter(markdown);

  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) return truncate(heading[1]);
  }

  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return truncate(trimmed);
  }

  return '';
}

function truncate(value: string): string {
  return value.length > MAX_TITLE_LENGTH ? value.slice(0, MAX_TITLE_LENGTH) : value;
}

/**
 * Decides whether an inline code span names a file rather than a command.
 * Commands contain whitespace and flags start with a dash; a path either has
 * a separator or an extension.
 */
function isPathLike(value: string): boolean {
  if (!value || /\s/.test(value)) return false;
  if (value.startsWith('-')) return false;
  return value.includes('/') || /\.[A-Za-z0-9]{1,8}$/.test(value);
}

/** Strips an alias, heading or block reference from a wikilink target. */
function cleanWikilinkTarget(inner: string): string {
  const withoutAlias = inner.split('|')[0];
  const withoutHeading = withoutAlias.split('#')[0];
  return withoutHeading.split('^')[0].trim();
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

/**
 * Extracts the vault paths a plan refers to, from path-like inline code spans
 * and wikilinks. Results keep their order of appearance and are deduped.
 */
export function extractPlanTargets(markdown: string): string[] {
  const body = stripFencedBlocks(stripFrontmatter(markdown));
  const found: { index: number; target: string }[] = [];

  INLINE_CODE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_CODE_PATTERN.exec(body)) !== null) {
    const candidate = normalizePath(match[1]);
    if (isPathLike(candidate)) {
      found.push({ index: match.index, target: candidate });
    }
  }

  WIKILINK_PATTERN.lastIndex = 0;
  while ((match = WIKILINK_PATTERN.exec(body)) !== null) {
    const candidate = normalizePath(cleanWikilinkTarget(match[1]));
    if (candidate) {
      found.push({ index: match.index, target: candidate });
    }
  }

  found.sort((a, b) => a.index - b.index);

  const seen = new Set<string>();
  const targets: string[] = [];
  for (const { target } of found) {
    if (seen.has(target)) continue;
    seen.add(target);
    targets.push(target);
  }
  return targets;
}

/** Parsed shape of a plan's markdown. */
export interface ParsedPlanMarkdown {
  title: string;
  targets: string[];
}

/** Extracts the title and targets a plan's markdown declares. */
export function parsePlanMarkdown(markdown: string): ParsedPlanMarkdown {
  return {
    title: extractPlanTitle(markdown),
    targets: extractPlanTargets(markdown),
  };
}

/** Builds a draft plan from Plan Mode's markdown output. */
export function createPlanFromMarkdown(
  markdown: string,
  options: CreatePlanOptions
): VaultPlan {
  const parsed = parsePlanMarkdown(markdown);

  return {
    id: options.id,
    title: parsed.title || 'Untitled plan',
    kind: options.kind ?? 'custom',
    targets: options.targets ?? parsed.targets,
    rationale: markdown,
    constraints: options.constraints ?? [],
    postconditions: options.postconditions ?? [],
    status: 'draft',
    createdAt: options.now,
  };
}
