/**
 * LinkIntegrityProbe - every wikilink resolves to a file in the vault.
 *
 * Broken links are the most common way an agent's file moves and renames
 * quietly damage a vault, and they are cheap to observe.
 */

import { buildFileIndex, isScannableNote, parseLinks, resolveLink } from '../linkParser';
import type { Probe, ProbeFinding, ProbeResult, ProbeSeverity, VaultSnapshot } from '../types';

/** Options for {@link LinkIntegrityProbe}. */
export interface LinkIntegrityOptions {
  /** Severity to report when links are broken. Defaults to `degraded`. */
  severity?: ProbeSeverity;
}

export class LinkIntegrityProbe implements Probe {
  readonly id = 'link-integrity';
  readonly description = 'Wikilinks resolve to a file in the vault';

  private readonly severity: ProbeSeverity;

  constructor(options: LinkIntegrityOptions = {}) {
    this.severity = options.severity ?? 'degraded';
  }

  run(snapshot: VaultSnapshot): ProbeResult {
    const index = buildFileIndex(snapshot.files.map((f) => f.path));
    const findings: ProbeFinding[] = [];
    let filesChecked = 0;

    for (const file of snapshot.files) {
      if (!isScannableNote(file)) continue;
      filesChecked++;

      for (const link of parseLinks(file.content as string)) {
        if (link.embed) continue;
        if (resolveLink(link.target, index)) continue;

        findings.push({
          path: file.path,
          line: link.line,
          target: link.target,
          message: `Unresolved link: [[${link.target}]]`,
        });
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
