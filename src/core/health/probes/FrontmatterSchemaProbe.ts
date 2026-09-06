/**
 * FrontmatterSchemaProbe - notes under a path carry the fields they must.
 *
 * Lets a vault declare its own structural invariants, so a plan that
 * reorganizes notes can be verified against them rather than trusted.
 */

import { isScannableNote } from '../linkParser';
import type { Probe, ProbeFinding, ProbeResult, ProbeSeverity, VaultSnapshot } from '../types';

/** Required fields for notes under a path prefix. An empty prefix matches all. */
export interface FrontmatterRule {
  pathPrefix: string;
  required: string[];
}

/** Options for {@link FrontmatterSchemaProbe}. */
export interface FrontmatterSchemaOptions {
  rules: FrontmatterRule[];
  /** Severity to report when fields are missing. Defaults to `degraded`. */
  severity?: ProbeSeverity;
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;
const TOP_LEVEL_KEY_PATTERN = /^([A-Za-z0-9_-]+)\s*:/;

/**
 * Returns the top-level frontmatter keys, or null when the note has no
 * frontmatter block at all. Nested keys and list items are ignored — this is
 * a field-presence check, not a YAML parser.
 */
export function extractFrontmatterKeys(content: string): string[] | null {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) return null;

  const keys: string[] = [];
  for (const line of match[1].split(/\r?\n/)) {
    const key = line.match(TOP_LEVEL_KEY_PATTERN);
    if (key) keys.push(key[1]);
  }
  return keys;
}

export class FrontmatterSchemaProbe implements Probe {
  readonly id = 'frontmatter-schema';
  readonly description = 'Notes carry the frontmatter fields their folder requires';

  private readonly rules: FrontmatterRule[];
  private readonly severity: ProbeSeverity;

  constructor(options: FrontmatterSchemaOptions) {
    this.rules = options.rules;
    this.severity = options.severity ?? 'degraded';
  }

  run(snapshot: VaultSnapshot): ProbeResult {
    const findings: ProbeFinding[] = [];
    let filesChecked = 0;

    for (const file of snapshot.files) {
      if (!isScannableNote(file)) continue;

      const rules = this.rules.filter((rule) => file.path.startsWith(rule.pathPrefix));
      if (rules.length === 0) continue;
      filesChecked++;

      const keys = extractFrontmatterKeys(file.content as string);

      if (keys === null) {
        if (rules.some((rule) => rule.required.length > 0)) {
          findings.push({ path: file.path, message: 'Missing frontmatter block' });
        }
        continue;
      }

      const present = new Set(keys);
      for (const rule of rules) {
        for (const field of rule.required) {
          if (present.has(field)) continue;
          findings.push({ path: file.path, message: `Missing frontmatter field: ${field}` });
        }
      }
    }

    return {
      probeId: this.id,
      status: findings.length > 0 ? this.severity : 'healthy',
      findings,
      filesChecked,
    };
  }
}
