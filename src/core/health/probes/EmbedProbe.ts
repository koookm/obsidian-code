/**
 * EmbedProbe - every `![[...]]` embed resolves to a file in the vault.
 *
 * Split from link integrity because embeds usually point at attachments and
 * can be written relative to the configured media folder.
 */

import { buildFileIndex, isScannableNote, parseLinks, resolveLink } from '../linkParser';
import type { Probe, ProbeFinding, ProbeResult, ProbeSeverity, VaultSnapshot } from '../types';

/** Options for {@link EmbedProbe}. */
export interface EmbedProbeOptions {
  /** The vault's attachment folder, from the `mediaFolder` setting. */
  mediaFolder?: string;
  /** Severity to report when embeds are broken. Defaults to `degraded`. */
  severity?: ProbeSeverity;
}

export class EmbedProbe implements Probe {
  readonly id = 'embed-integrity';
  readonly description = 'Embedded files resolve to a file in the vault';

  private readonly mediaFolder: string;
  private readonly severity: ProbeSeverity;

  constructor(options: EmbedProbeOptions = {}) {
    this.mediaFolder = options.mediaFolder ?? '';
    this.severity = options.severity ?? 'degraded';
  }

  run(snapshot: VaultSnapshot): ProbeResult {
    const index = buildFileIndex(snapshot.files.map((f) => f.path));
    const extraFolders = this.mediaFolder ? [this.mediaFolder] : [];
    const findings: ProbeFinding[] = [];
    let filesChecked = 0;

    for (const file of snapshot.files) {
      if (!isScannableNote(file)) continue;
      filesChecked++;

      for (const link of parseLinks(file.content as string)) {
        if (!link.embed) continue;
        if (resolveLink(link.target, index, { extraFolders })) continue;

        findings.push({
          path: file.path,
          line: link.line,
          target: link.target,
          message: `Unresolved embed: ![[${link.target}]]`,
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
