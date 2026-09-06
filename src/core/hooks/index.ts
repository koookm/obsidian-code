/**
 * Hooks barrel export.
 */

export {
  type ChangeSink,
  type ChangeSinkEntry,
  createFileHashPostHook,
  createFileHashPreHook,
  type DiffContentEntry,
  type FileEditPostCallback,
  MAX_DIFF_SIZE,
} from './DiffTrackingHooks';
export {
  type BlocklistContext,
  createBlocklistHook,
  createVaultRestrictionHook,
  type VaultRestrictionContext,
} from './SecurityHooks';
