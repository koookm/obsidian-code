/**
 * Vault health types.
 *
 * A probe answers "is the vault still sound?" from observable facts rather
 * than from what an agent reported about its own work. That distinction is
 * the point: agent output is non-deterministic, so a plan can only be
 * verified against invariants the vault itself exhibits.
 *
 * Pure module — no Obsidian imports, so probes stay testable in isolation.
 */

/** Aggregate health of a probe or of a whole run. */
export type ProbeStatus = 'healthy' | 'degraded' | 'failed';

/** The severity a probe reports when it finds something. */
export type ProbeSeverity = Exclude<ProbeStatus, 'healthy'>;

/** A single problem a probe found. */
export interface ProbeFinding {
  /** Vault-relative path of the file the problem is in. */
  path: string;
  message: string;
  /** 1-indexed line, when the problem has one. */
  line?: number;
  /** The unresolved target or offending value, when there is one. */
  target?: string;
}

/** What one probe concluded. */
export interface ProbeResult {
  probeId: string;
  status: ProbeStatus;
  findings: ProbeFinding[];
  /** How many files the probe actually inspected. */
  filesChecked: number;
}

/**
 * One file in the vault. `content` is absent for files a probe cannot read as
 * text (attachments); their paths still matter, because links resolve to them.
 */
export interface VaultFileSnapshot {
  path: string;
  content?: string;
}

/** The slice of the vault a probe run sees. */
export interface VaultSnapshot {
  files: VaultFileSnapshot[];
}

/** A check that can be run over a vault snapshot. */
export interface Probe {
  readonly id: string;
  readonly description: string;
  run(snapshot: VaultSnapshot): ProbeResult;
}
