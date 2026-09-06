/**
 * Diff Tracking Hooks
 *
 * Pre/Post ToolUse hooks for capturing file content before and after edits.
 */

import type { HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk';
import * as fs from 'fs';
import * as path from 'path';

import { normalizePathForFilesystem } from '../../utils/path';
import { TOOL_EDIT, TOOL_WRITE } from '../tools/toolNames';
import type { ToolDiffData } from '../types';

/** Maximum file size for diff capture (100KB). */
export const MAX_DIFF_SIZE = 100 * 1024;

/** Callback for post-edit tracking. */
export interface FileEditPostCallback {
  trackEditedFile(
    toolName: string | undefined,
    toolInput: Record<string, unknown> | undefined,
    isError: boolean
  ): Promise<void>;
}

/**
 * Storage for original file contents keyed by tool_use_id.
 */
export interface DiffContentEntry {
  filePath: string;
  content: string | null;
  /**
   * Whether the file existed before the edit. The diff view treats a new file
   * as empty content, but a journal must tell "was empty" from "was absent" —
   * only the second one is undone by deleting the file.
   */
  existed?: boolean;
  skippedReason?: 'too_large' | 'unavailable';
}

/** A file change reported to the journal after a successful edit. */
export interface ChangeSinkEntry {
  filePath: string;
  toolName: string;
  /** Content before the edit; null when the file did not exist or was not captured. */
  before: string | null;
  /** Content after the edit; null when it was not captured. */
  after: string | null;
  skippedReason?: 'too_large' | 'unavailable';
}

/** Receives each captured file change so it can be journalled. */
export type ChangeSink = (entry: ChangeSinkEntry) => void;

/**
 * Create a PreToolUse hook to capture original file content before editing.
 */
export function createFileHashPreHook(
  vaultPath: string | null,
  originalContents: Map<string, DiffContentEntry>
): HookCallbackMatcher {
  return {
    matcher: 'Write|Edit|NotebookEdit',
    hooks: [
      async (hookInput, toolUseId, _options) => {
        const input = hookInput as {
          tool_name: string;
          tool_input: Record<string, unknown>;
        };

        // Capture original content for diff (Write/Edit only, not NotebookEdit)
        if (input.tool_name === TOOL_WRITE || input.tool_name === TOOL_EDIT) {
          const rawPath = input.tool_input.file_path;
          const filePath = typeof rawPath === 'string' && rawPath ? rawPath : undefined;

          if (filePath && vaultPath && toolUseId) {
            const normalizedPath = normalizePathForFilesystem(filePath);
            const fullPath = path.isAbsolute(normalizedPath)
              ? normalizedPath
              : path.join(vaultPath, normalizedPath);

            try {
              if (fs.existsSync(fullPath)) {
                const stats = fs.statSync(fullPath);
                if (stats.size <= MAX_DIFF_SIZE) {
                  const content = fs.readFileSync(fullPath, 'utf-8');
                  originalContents.set(toolUseId, { filePath, content, existed: true });
                } else {
                  // File too large for diff
                  originalContents.set(toolUseId, { filePath, content: null, skippedReason: 'too_large' });
                }
              } else {
                // New file
                originalContents.set(toolUseId, { filePath, content: '', existed: false });
              }
            } catch (error) {
              console.warn('Failed to capture original file contents:', fullPath, error);
              originalContents.set(toolUseId, { filePath, content: null, skippedReason: 'unavailable' });
            }
          }
        }

        return { continue: true };
      },
    ],
  };
}

/**
 * Create a PostToolUse hook to capture post-edit content and compute diff.
 */
export function createFileHashPostHook(
  vaultPath: string | null,
  originalContents: Map<string, DiffContentEntry>,
  pendingDiffData: Map<string, ToolDiffData>,
  postCallback?: FileEditPostCallback,
  onChange?: ChangeSink
): HookCallbackMatcher {
  return {
    matcher: 'Write|Edit|NotebookEdit',
    hooks: [
      async (hookInput, toolUseId, _options) => {
        const input = hookInput as {
          tool_name: string;
          tool_input: Record<string, unknown>;
          tool_result?: { is_error?: boolean };
        };
        const isError = input.tool_result?.is_error ?? false;

        // Compute diff for Write/Edit (if not error)
        if ((input.tool_name === TOOL_WRITE || input.tool_name === TOOL_EDIT) && toolUseId) {
          const originalEntry = originalContents.get(toolUseId);
          const rawPath = input.tool_input.file_path;
          const filePath =
            typeof rawPath === 'string' && rawPath ? rawPath : originalEntry?.filePath;

          if (!isError && filePath && vaultPath) {
            const normalizedPath = normalizePathForFilesystem(filePath);
            const fullPath = path.isAbsolute(normalizedPath)
              ? normalizedPath
              : path.join(vaultPath, normalizedPath);

            let diffData: ToolDiffData | undefined;

            // If original was too large/unavailable, propagate skip reason
            if (originalEntry?.content === null) {
              diffData = { filePath, skippedReason: originalEntry.skippedReason ?? 'unavailable' };
            } else {
              try {
                if (fs.existsSync(fullPath)) {
                  const stats = fs.statSync(fullPath);
                  if (stats.size <= MAX_DIFF_SIZE) {
                    const newContent = fs.readFileSync(fullPath, 'utf-8');
                    if (originalEntry && originalEntry.content !== undefined) {
                      diffData = {
                        filePath,
                        originalContent: originalEntry.content,
                        newContent,
                      };
                    } else {
                      diffData = { filePath, skippedReason: 'unavailable' };
                    }
                  } else {
                    diffData = { filePath, skippedReason: 'too_large' };
                  }
                } else {
                  diffData = { filePath, skippedReason: 'unavailable' };
                }
              } catch (error) {
                console.warn('Failed to capture updated file contents:', fullPath, error);
                diffData = { filePath, skippedReason: 'unavailable' };
              }
            }

            if (diffData) {
              pendingDiffData.set(toolUseId, diffData);
              onChange?.(toChangeSinkEntry(input.tool_name, diffData, originalEntry));
            }
          }

          // Clean up original content map regardless of success/error
          originalContents.delete(toolUseId);
        }

        await postCallback?.trackEditedFile(input.tool_name, input.tool_input, isError);
        return { continue: true };
      },
    ],
  };
}

/**
 * Maps captured diff data onto a journal entry. A file that did not exist
 * before the edit is reported as `before: null` so reverting deletes it rather
 * than leaving an empty file behind.
 */
function toChangeSinkEntry(
  toolName: string,
  diffData: ToolDiffData,
  originalEntry: DiffContentEntry | undefined
): ChangeSinkEntry {
  if (diffData.skippedReason || diffData.originalContent === undefined) {
    return {
      filePath: diffData.filePath,
      toolName,
      before: null,
      after: null,
      skippedReason: diffData.skippedReason ?? 'unavailable',
    };
  }

  return {
    filePath: diffData.filePath,
    toolName,
    before: originalEntry?.existed === false ? null : diffData.originalContent,
    after: diffData.newContent ?? null,
  };
}
