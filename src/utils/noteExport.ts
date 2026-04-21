/**
 * ObsidianCode - Note export utilities
 *
 * Formats a Conversation as Markdown and appends it to the currently
 * active note in the vault. The formatter is pure and framework-free so it
 * can be unit-tested without the Obsidian API.
 */

import type { App, TFile } from 'obsidian';

import type { ChatMessage, Conversation } from '../core/types';

const CONVERSATION_HEADING_PREFIX = '## Obsidian Code — ';
const SUMMARY_HEADING_PREFIX = '## Obsidian Code 요약 — ';

function messageText(msg: ChatMessage): string {
  const source = msg.displayContent ?? msg.content;
  return source.trim();
}

function renderMessage(msg: ChatMessage): string | null {
  if (msg.hidden) return null;
  const text = messageText(msg);
  if (!text) return null;
  const label = msg.role === 'user' ? '**User:**' : '**Assistant:**';
  return `${label}\n\n${text}`;
}

/**
 * Formats a full conversation as a Markdown block. Returns empty string
 * if the conversation has no renderable messages.
 */
export function formatConversationAsMarkdown(conversation: Conversation): string {
  const blocks = conversation.messages
    .map(renderMessage)
    .filter((block): block is string => block !== null);

  if (blocks.length === 0) return '';

  const heading = `${CONVERSATION_HEADING_PREFIX}${conversation.title}`;
  return `${heading}\n\n${blocks.join('\n\n')}\n`;
}

/**
 * Formats a pre-generated summary as a Markdown block. Returns empty string
 * if the summary body is blank.
 */
export function formatSummaryAsMarkdown(title: string, summary: string): string {
  const trimmed = summary.trim();
  if (!trimmed) return '';
  const heading = `${SUMMARY_HEADING_PREFIX}${title}`;
  return `${heading}\n\n${trimmed}\n`;
}

/**
 * Appends a Markdown snippet to a TFile, inserting a blank-line separator
 * when the existing file does not already end with one.
 */
export async function appendMarkdownToFile(
  app: App,
  file: TFile,
  markdown: string
): Promise<void> {
  const existing = await app.vault.read(file);
  let separator: string;
  if (existing.length === 0 || existing.endsWith('\n\n')) {
    separator = '';
  } else if (existing.endsWith('\n')) {
    separator = '\n';
  } else {
    separator = '\n\n';
  }
  await app.vault.modify(file, existing + separator + markdown);
}
