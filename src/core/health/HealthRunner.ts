/**
 * HealthRunner - runs a set of probes over a vault snapshot.
 *
 * The comparison helper matters as much as the run: a vault almost always
 * carries pre-existing findings, so gating a plan on "the vault is clean"
 * would block everything. What a plan is accountable for is the findings it
 * introduced.
 */

import type { Probe, ProbeFinding, ProbeResult, ProbeStatus, VaultSnapshot } from './types';

/** The outcome of one probe run. */
export interface HealthReport {
  status: ProbeStatus;
  results: ProbeResult[];
  ranAt: number;
}

/** A finding paired with the probe that reported it. */
export interface AttributedFinding extends ProbeFinding {
  probeId: string;
}

const STATUS_RANK: Record<ProbeStatus, number> = {
  healthy: 0,
  degraded: 1,
  failed: 2,
};

/** Reduces statuses to the worst one; no statuses means healthy. */
export function worstStatus(statuses: ProbeStatus[]): ProbeStatus {
  return statuses.reduce<ProbeStatus>(
    (worst, status) => (STATUS_RANK[status] > STATUS_RANK[worst] ? status : worst),
    'healthy'
  );
}

export class HealthRunner {
  constructor(private probes: Probe[]) {}

  /** Runs every probe. A probe that throws fails alone, not the whole run. */
  run(snapshot: VaultSnapshot, now: number = Date.now()): HealthReport {
    const results = this.probes.map((probe) => {
      try {
        return probe.run(snapshot);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          probeId: probe.id,
          status: 'failed' as const,
          findings: [{ path: '', message: `Probe threw: ${message}` }],
          filesChecked: 0,
        };
      }
    });

    return { status: worstStatus(results.map((r) => r.status)), results, ranAt: now };
  }
}

/**
 * Identity of a finding for before/after comparison.
 *
 * The line is deliberately excluded: inserting a paragraph shifts every line
 * below it, and a gate that flagged those as new findings would fire on any
 * edit. The cost is that a second broken link to the same target in the same
 * file does not register as new.
 */
function findingKey(probeId: string, finding: ProbeFinding): string {
  return [probeId, finding.path, finding.target ?? '', finding.message].join(' ');
}

function keysOf(report: HealthReport): Set<string> {
  const keys = new Set<string>();
  for (const result of report.results) {
    for (const finding of result.findings) {
      keys.add(findingKey(result.probeId, finding));
    }
  }
  return keys;
}

/** Findings present after a change that were not present before it. */
export function newFindings(before: HealthReport, after: HealthReport): AttributedFinding[] {
  const known = keysOf(before);
  const introduced: AttributedFinding[] = [];

  for (const result of after.results) {
    for (const finding of result.findings) {
      if (known.has(findingKey(result.probeId, finding))) continue;
      introduced.push({ probeId: result.probeId, ...finding });
    }
  }

  return introduced;
}
