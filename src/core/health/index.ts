/**
 * Health barrel export.
 */

export {
  type AttributedFinding,
  type HealthReport,
  HealthRunner,
  newFindings,
  worstStatus,
} from './HealthRunner';
export {
  buildFileIndex,
  type FileIndex,
  isScannableNote,
  maskCode,
  type ParsedLink,
  parseLinks,
  resolveLink,
  type ResolveOptions,
} from './linkParser';
export { EmbedProbe, type EmbedProbeOptions } from './probes/EmbedProbe';
export {
  extractFrontmatterKeys,
  type FrontmatterRule,
  type FrontmatterSchemaOptions,
  FrontmatterSchemaProbe,
} from './probes/FrontmatterSchemaProbe';
export { type LinkIntegrityOptions,LinkIntegrityProbe } from './probes/LinkIntegrityProbe';
export {
  type Probe,
  type ProbeFinding,
  type ProbeResult,
  type ProbeSeverity,
  type ProbeStatus,
  type VaultFileSnapshot,
  type VaultSnapshot,
} from './types';
