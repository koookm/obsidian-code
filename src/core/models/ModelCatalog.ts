/**
 * ObsidianCode - Model catalog.
 *
 * Turns a flat list of model ids (fetched from the Anthropic API, or the
 * offline fallback list) into a two-tier catalog:
 *
 *   - `latest`   : one entry per model family, preferring the CLI alias
 *                  (`opus`, `sonnet`, `haiku`, `fable`) so it always resolves
 *                  to the newest release without any plugin update.
 *   - `previous` : pinned ids — the current version plus the one before it —
 *                  shown behind the "more" disclosure in the UI.
 *
 * Everything is derived from the model id itself, so a brand new family or
 * version shows up automatically once the API returns it.
 */

import { getModelsFromEnvironment, parseEnvironmentVariables } from '../../utils/env';

/** A model as provided by the API, the env vars, or the fallback list. */
export interface RawModelEntry {
  value: string;
  label?: string;
  description?: string;
}

/** A model entry ready for display. */
export interface CatalogEntry {
  value: string;
  label: string;
  description: string;
  /** Parsed family (`opus`, `sonnet`, `fable`, ...); `other` when unparseable. */
  family: string;
  /** True when `value` is a CLI alias that resolves at runtime. */
  isAlias: boolean;
  /** For aliases: the pinned id the alias currently resolves to. */
  resolvedId?: string;
}

/** Two-tier catalog plus a flat lookup list. */
export interface ModelCatalog {
  /** Latest model per family (CLI aliases where available). */
  latest: CatalogEntry[];
  /** Pinned versions (current + immediately previous) per family. */
  previous: CatalogEntry[];
  /** Every entry in `latest` and `previous`, for lookups. */
  all: CatalogEntry[];
  /** Where the underlying model list came from. */
  source: 'api' | 'env' | 'default';
}

/** Parsed components of a model id. */
export interface ParsedModelId {
  /** Family name, e.g. `opus`. Empty when the id has no alphabetic family token. */
  family: string;
  /** Version numbers, e.g. `[4, 8]` for `claude-opus-4-8`. */
  version: number[];
  /** Release date suffix (`20251001`), when present. */
  date: string | null;
}

/** Families the Claude CLI exposes as a "latest" alias. */
export const CLI_ALIAS_FAMILIES: ReadonlySet<string> = new Set([
  'fable',
  'opus',
  'sonnet',
  'haiku',
]);

/** Display order for known families; unknown (new) families sort first. */
const FAMILY_RANK: Record<string, number> = {
  fable: 0,
  opus: 1,
  sonnet: 2,
  haiku: 3,
  other: 99,
};

/** How many pinned versions per family the "more" section shows. */
const PREVIOUS_VERSIONS_PER_FAMILY = 2;

/** Strips provider/region qualifiers so Bedrock & Vertex ids parse like plain ones. */
function stripProviderPrefix(id: string): string {
  let out = id.trim().toLowerCase();
  const slash = out.lastIndexOf('/');
  if (slash >= 0) out = out.slice(slash + 1);
  out = out.replace(/^(us|eu|apac)\./, '');
  out = out.replace(/^anthropic\./, '');
  out = out.replace(/-v\d+:\d+$/, '');
  return out;
}

/**
 * Parses a model id into family / version / date.
 *
 * Handles both modern (`claude-opus-4-8`) and legacy (`claude-3-5-sonnet-20241022`)
 * orderings, plus bare CLI aliases (`opus`).
 */
export function parseModelId(id: string): ParsedModelId {
  const normalized = stripProviderPrefix(id).replace(/^claude[-.]/, '');
  if (!normalized) return { family: '', version: [], date: null };

  const tokens = normalized.split(/[-.]/).filter(Boolean);
  const familyParts: string[] = [];
  const version: number[] = [];
  let date: string | null = null;

  for (const token of tokens) {
    if (/^\d{8}$/.test(token)) {
      date = token;
    } else if (/^\d+$/.test(token)) {
      version.push(Number(token));
    } else if (token !== 'latest' && token !== 'v') {
      familyParts.push(token);
    }
  }

  return { family: familyParts.join('-'), version, date };
}

/** Human-readable label for a model id, e.g. `claude-opus-4-8` → `Claude Opus 4.8`. */
export function formatModelLabel(id: string): string {
  const short = formatModelShortLabel(id);
  return short === id ? id : `Claude ${short}`;
}

/**
 * Compact label without the `Claude` prefix, e.g. `claude-opus-4-8` → `Opus 4.8`.
 * Used in the model menu, where the vendor prefix is noise on every row.
 */
export function formatModelShortLabel(id: string): string {
  const { family, version } = parseModelId(id);
  if (!family) return id;

  const familyLabel = family
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  const versionLabel = version.join('.');
  return versionLabel ? `${familyLabel} ${versionLabel}` : familyLabel;
}

/** Title-cased family name, e.g. `opus` → `Opus`. */
function familyTitle(family: string): string {
  return family
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Compares two parsed ids; newest first. */
function compareParsed(a: ParsedModelId, b: ParsedModelId): number {
  const len = Math.max(a.version.length, b.version.length);
  for (let i = 0; i < len; i++) {
    const diff = (b.version[i] ?? 0) - (a.version[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return (b.date ?? '').localeCompare(a.date ?? '');
}

/**
 * True for first-party Claude ids and CLI aliases (`claude-opus-5`, `opus`).
 * Provider-qualified or third-party ids from environment variables are not.
 */
export function isClaudeModelId(id: string): boolean {
  if (!id) return false;
  const trimmed = id.trim();
  if (CLI_ALIAS_FAMILIES.has(trimmed)) return true;
  return /^claude-/.test(trimmed) && !trimmed.includes('/');
}

/** True when the id looks like a real model id rather than stray text. */
export function isPlausibleModelId(id: string): boolean {
  if (!id) return false;
  const trimmed = id.trim();
  if (!trimmed || trimmed.length > 100 || /\s/.test(trimmed)) return false;
  // Provider-qualified custom ids (Bedrock, Vertex, proxies) are always accepted.
  if (trimmed.includes('/') || trimmed.includes(':')) return true;
  const parsed = parseModelId(trimmed);
  return parsed.family.length > 0 && (parsed.version.length > 0 || parsed.date !== null);
}

interface GroupedEntry {
  raw: RawModelEntry;
  parsed: ParsedModelId;
}

/** Buckets models by family, dropping duplicate versions (dated + undated ids). */
function groupByFamily(models: RawModelEntry[]): Map<string, GroupedEntry[]> {
  const groups = new Map<string, GroupedEntry[]>();

  for (const raw of models) {
    if (!raw?.value) continue;
    const parsed = parseModelId(raw.value);
    // Bare CLI aliases carry no version; they are re-derived from pinned ids.
    if (parsed.version.length === 0 && !parsed.date) continue;

    const family = parsed.family || 'other';
    const bucket = groups.get(family) ?? [];
    bucket.push({ raw, parsed });
    groups.set(family, bucket);
  }

  for (const [family, bucket] of groups) {
    bucket.sort((a, b) => compareParsed(a.parsed, b.parsed));

    // One entry per version: prefer the undated id, else the newest dated one.
    const byVersion = new Map<string, GroupedEntry>();
    for (const entry of bucket) {
      const key = entry.parsed.version.join('.');
      const existing = byVersion.get(key);
      if (!existing) {
        byVersion.set(key, entry);
      } else if (existing.parsed.date && !entry.parsed.date) {
        byVersion.set(key, entry);
      }
    }
    groups.set(family, [...byVersion.values()]);
  }

  return groups;
}

/** Orders families for display: unknown (new) first, then fable → opus → sonnet → haiku. */
function sortFamilies(families: string[]): string[] {
  return [...families].sort((a, b) => {
    const rankA = FAMILY_RANK[a] ?? -1;
    const rankB = FAMILY_RANK[b] ?? -1;
    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b);
  });
}

/** Builds the two-tier catalog from a flat model list. */
export function buildModelCatalog(
  models: RawModelEntry[],
  source: ModelCatalog['source'] = 'default'
): ModelCatalog {
  const groups = groupByFamily(models);
  const families = sortFamilies([...groups.keys()]);

  const latest: CatalogEntry[] = [];
  const previous: CatalogEntry[] = [];

  for (const family of families) {
    const entries = groups.get(family);
    if (!entries || entries.length === 0) continue;

    const top = entries[0];

    if (CLI_ALIAS_FAMILIES.has(family)) {
      // The row is named after the version the alias resolves to right now, so
      // it reads as "Opus 5" and renames itself when Opus 6 ships.
      latest.push({
        value: family,
        label: formatModelShortLabel(top.raw.value),
        description: `항상 최신 ${familyTitle(family)}로 연결 (현재 ${top.raw.value})`,
        family,
        isAlias: true,
        resolvedId: top.raw.value,
      });
    } else {
      latest.push({
        value: top.raw.value,
        label: formatModelShortLabel(top.raw.value),
        description: top.raw.description || top.raw.value,
        family,
        isAlias: false,
      });
    }

    // Alias families show both pinned versions; families already pinned in the
    // "latest" tier only need the version before it.
    const pinned = CLI_ALIAS_FAMILIES.has(family)
      ? entries.slice(0, PREVIOUS_VERSIONS_PER_FAMILY)
      : entries.slice(1, PREVIOUS_VERSIONS_PER_FAMILY);

    for (const entry of pinned) {
      previous.push({
        value: entry.raw.value,
        label: formatModelShortLabel(entry.raw.value),
        // The full id is the point of this tier: it pins the version.
        description: entry.raw.value,
        family,
        isAlias: false,
      });
    }
  }

  return { latest, previous, all: [...latest, ...previous], source };
}

/** Wraps a raw model list as a flat catalog (custom endpoints, env vars). */
function flatCatalog(models: RawModelEntry[], source: ModelCatalog['source']): ModelCatalog {
  const latest = models.map((m) => ({
    value: m.value,
    label: m.label || formatModelShortLabel(m.value),
    description: m.description || '',
    family: parseModelId(m.value).family || 'other',
    isAlias: false,
  }));
  return { latest, previous: [], all: latest, source };
}

/** Inputs used to decide which model list backs the catalog. */
export interface ResolveCatalogOptions {
  /** Model list fetched from the Anthropic API (null when unavailable). */
  runtimeModels?: RawModelEntry[] | null;
  /** Raw `KEY=VALUE` environment variable text from settings. */
  envText?: string;
  /** Offline fallback list. */
  fallbackModels: RawModelEntry[];
}

/**
 * Resolves the catalog shown in the UI.
 *
 * A custom `ANTHROPIC_BASE_URL` means the Anthropic model list does not apply,
 * so the env-declared models are used verbatim. Otherwise the API list (or the
 * offline fallback) is grouped into tiers and any env-declared models are
 * appended to the "more" section.
 */
export function resolveModelCatalog(options: ResolveCatalogOptions): ModelCatalog {
  const envVars = options.envText ? parseEnvironmentVariables(options.envText) : {};
  const envModels = options.envText ? getModelsFromEnvironment(envVars) : [];
  const hasCustomEndpoint = Boolean(envVars['ANTHROPIC_BASE_URL']);

  if (envModels.length > 0 && hasCustomEndpoint) {
    return flatCatalog(envModels, 'env');
  }

  const runtime = options.runtimeModels;
  const base = runtime && runtime.length > 0 ? runtime : options.fallbackModels;
  const catalog = buildModelCatalog(base, runtime && runtime.length > 0 ? 'api' : 'default');

  if (envModels.length === 0) return catalog;

  const known = new Set(catalog.all.map((m) => m.value));
  const extras: CatalogEntry[] = envModels
    .filter((m) => !known.has(m.value))
    .map((m) => ({
      value: m.value,
      label: m.label || formatModelShortLabel(m.value),
      description: m.description || '환경 변수',
      family: parseModelId(m.value).family || 'other',
      isAlias: false,
    }));

  if (extras.length === 0) return catalog;

  const previous = [...catalog.previous, ...extras];
  return { ...catalog, previous, all: [...catalog.latest, ...previous] };
}

/** Finds a catalog entry by model id, or synthesizes one for unknown ids. */
export function findCatalogEntry(catalog: ModelCatalog, value: string): CatalogEntry {
  const found = catalog.all.find((m) => m.value === value);
  if (found) return found;
  return {
    value,
    label: formatModelShortLabel(value),
    description: '',
    family: parseModelId(value).family || 'other',
    isAlias: false,
  };
}
