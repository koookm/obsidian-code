/**
 * ChangeJournal - durable record of the file changes a plan made.
 *
 * The diff hooks already capture a file's content either side of an edit for
 * display; this persists that same pair so a plan can be undone as a state
 * change rather than a manual recovery.
 *
 * Stored as JSONL under `.claude/journal/{planId}.jsonl`, one record per file
 * change, following the session storage layout.
 */

import type { VaultFileAdapter } from '../storage/VaultFileAdapter';

/** Path to the journal folder relative to vault root. */
export const JOURNAL_PATH = '.claude/journal';

/** Largest content we store per side of a change (100KB, matching the diff hooks). */
export const DEFAULT_MAX_ENTRY_SIZE = 100 * 1024;

/** Why a change could not be captured well enough to be reverted. */
export type ChangeSkipReason = 'too_large' | 'unavailable';

/** Why a file could not be reverted. */
export type RevertSkipReason = 'not_captured' | 'modified_since';

/** A single file change made under a plan. */
export interface ChangeRecord {
  planId: string;
  filePath: string;
  toolName: string;
  timestamp: number;
  /** Content before the change; null means the file did not exist. */
  before: string | null;
  /** Content after the change; null means the file was deleted. */
  after: string | null;
  skippedReason?: ChangeSkipReason;
}

/** Input accepted by {@link ChangeJournal.record}. */
export type ChangeRecordInput = Omit<ChangeRecord, 'skippedReason'> & {
  skippedReason?: ChangeSkipReason;
};

/** Outcome of reverting a plan. */
export interface RevertResult {
  reverted: string[];
  skipped: { filePath: string; reason: RevertSkipReason }[];
}

/** Options for {@link ChangeJournal.revert}. */
export interface RevertOptions {
  /** Restore even when the file changed after the plan ran. */
  force?: boolean;
}

/** Options for the journal itself. */
export interface ChangeJournalOptions {
  maxEntrySize?: number;
}

/** Plan ids become filenames, so they may not contain separators or dots. */
const VALID_PLAN_ID = /^[A-Za-z0-9_-]+$/;

export class ChangeJournal {
  private readonly maxEntrySize: number;

  constructor(
    private adapter: VaultFileAdapter,
    options: ChangeJournalOptions = {}
  ) {
    this.maxEntrySize = options.maxEntrySize ?? DEFAULT_MAX_ENTRY_SIZE;
  }

  /** Path of the journal file for a plan. */
  getFilePath(planId: string): string {
    assertValidPlanId(planId);
    return `${JOURNAL_PATH}/${planId}.jsonl`;
  }

  /**
   * Append a change. Content larger than the cap is dropped and marked, so a
   * later revert reports the gap rather than silently restoring nothing.
   */
  async record(input: ChangeRecordInput): Promise<void> {
    const filePath = this.getFilePath(input.planId);
    const record = this.normalize(input);
    await this.adapter.append(filePath, `${JSON.stringify(record)}\n`);
  }

  /** Load a plan's records in the order they were written. */
  async load(planId: string): Promise<ChangeRecord[]> {
    const filePath = this.getFilePath(planId);

    try {
      if (!(await this.adapter.exists(filePath))) return [];
      const content = await this.adapter.read(filePath);
      return parseJSONL(content);
    } catch (error) {
      console.error(`[ObsidianCode] Failed to load journal ${planId}:`, error);
      return [];
    }
  }

  /** List plan ids that have a journal. */
  async listPlanIds(): Promise<string[]> {
    try {
      const files = await this.adapter.listFiles(JOURNAL_PATH);
      return files
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => f.slice(f.lastIndexOf('/') + 1, -'.jsonl'.length))
        .filter((id) => id.length > 0);
    } catch (error) {
      console.error('[ObsidianCode] Failed to list journals:', error);
      return [];
    }
  }

  /** Delete a plan's journal. */
  async clear(planId: string): Promise<void> {
    await this.adapter.delete(this.getFilePath(planId));
  }

  /**
   * Keep the `keep` most recently written journals and delete the rest.
   * Returns the plan ids that were removed.
   */
  async prune(keep: number): Promise<string[]> {
    const ids = await this.listPlanIds();
    if (ids.length <= keep) return [];

    const withMtime = await Promise.all(
      ids.map(async (id) => ({
        id,
        mtime: (await this.adapter.stat(this.getFilePath(id)))?.mtime ?? 0,
      }))
    );

    withMtime.sort((a, b) => b.mtime - a.mtime);
    const doomed = withMtime.slice(keep);

    for (const { id } of doomed) {
      await this.clear(id);
    }
    return doomed.map((entry) => entry.id);
  }

  /**
   * Undo a plan's changes.
   *
   * Each file is restored to the state recorded before the plan's *first*
   * change to it, and the conflict check compares against the state after its
   * *last* change — so a file the user edited afterwards is left alone unless
   * the caller forces it.
   */
  async revert(planId: string, options: RevertOptions = {}): Promise<RevertResult> {
    const records = await this.load(planId);
    const result: RevertResult = { reverted: [], skipped: [] };

    for (const [filePath, { first, last, captured }] of groupByFile(records)) {
      if (!captured) {
        result.skipped.push({ filePath, reason: 'not_captured' });
        continue;
      }

      if (!options.force) {
        const current = await this.readOrNull(filePath);
        if (current !== last.after) {
          result.skipped.push({ filePath, reason: 'modified_since' });
          continue;
        }
      }

      if (first.before === null) {
        await this.adapter.delete(filePath);
      } else {
        await this.adapter.write(filePath, first.before);
      }
      result.reverted.push(filePath);
    }

    return result;
  }

  private normalize(input: ChangeRecordInput): ChangeRecord {
    const record: ChangeRecord = {
      planId: input.planId,
      filePath: input.filePath,
      toolName: input.toolName,
      timestamp: input.timestamp,
      before: input.before,
      after: input.after,
    };

    if (input.skippedReason) {
      return { ...record, before: null, after: null, skippedReason: input.skippedReason };
    }

    if (exceedsCap(input.before, this.maxEntrySize) || exceedsCap(input.after, this.maxEntrySize)) {
      return { ...record, before: null, after: null, skippedReason: 'too_large' };
    }

    return record;
  }

  private async readOrNull(filePath: string): Promise<string | null> {
    try {
      if (!(await this.adapter.exists(filePath))) return null;
      return await this.adapter.read(filePath);
    } catch {
      return null;
    }
  }
}

function assertValidPlanId(planId: string): void {
  if (!VALID_PLAN_ID.test(planId)) {
    throw new Error(`Invalid plan id for journal file name: ${planId}`);
  }
}

function exceedsCap(value: string | null, cap: number): boolean {
  return value !== null && value.length > cap;
}

function parseJSONL(content: string): ChangeRecord[] {
  const records: ChangeRecord[] = [];

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as ChangeRecord;
      if (typeof parsed?.filePath === 'string') {
        records.push(parsed);
      }
    } catch {
      // A truncated write should not cost us the rest of the journal.
    }
  }

  return records;
}

/** First and last record per file, plus whether every change was captured. */
function groupByFile(
  records: ChangeRecord[]
): Map<string, { first: ChangeRecord; last: ChangeRecord; captured: boolean }> {
  const grouped = new Map<string, { first: ChangeRecord; last: ChangeRecord; captured: boolean }>();

  for (const record of records) {
    const existing = grouped.get(record.filePath);
    const captured = !record.skippedReason;

    if (existing) {
      existing.last = record;
      existing.captured = existing.captured && captured;
    } else {
      grouped.set(record.filePath, { first: record, last: record, captured });
    }
  }

  return grouped;
}
