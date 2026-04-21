/**
 * Tests for noteExport utility.
 *
 * Covers the pure formatter; file-write is exercised manually in Obsidian.
 */

import {
  formatConversationAsMarkdown,
  formatSummaryAsMarkdown,
} from '@/utils/noteExport';
import type { ChatMessage, Conversation } from '@/core/types';

function makeMessage(
  role: 'user' | 'assistant',
  content: string,
  overrides: Partial<ChatMessage> = {}
): ChatMessage {
  return {
    id: `m-${role}-${content.slice(0, 6)}`,
    role,
    content,
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function makeConversation(messages: ChatMessage[], title = 'Sample chat'): Conversation {
  return {
    id: 'conv-1',
    title,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_005_000,
    sessionId: null,
    messages,
  };
}

describe('formatConversationAsMarkdown', () => {
  it('renders a heading with the conversation title and a user/assistant block for each message', () => {
    const conv = makeConversation([
      makeMessage('user', 'Refactor this function'),
      makeMessage('assistant', 'Here is the refactor...'),
    ]);

    const md = formatConversationAsMarkdown(conv);

    expect(md).toContain('## Obsidian Code — Sample chat');
    expect(md).toContain('**User:**');
    expect(md).toContain('Refactor this function');
    expect(md).toContain('**Assistant:**');
    expect(md).toContain('Here is the refactor...');
  });

  it('uses displayContent when provided (collapses expanded slash-command prompts)', () => {
    const conv = makeConversation([
      makeMessage('user', 'EXPANDED FULL PROMPT TEXT', { displayContent: '/tests' }),
    ]);

    const md = formatConversationAsMarkdown(conv);

    expect(md).toContain('/tests');
    expect(md).not.toContain('EXPANDED FULL PROMPT TEXT');
  });

  it('skips hidden messages', () => {
    const conv = makeConversation([
      makeMessage('user', 'visible question'),
      makeMessage('assistant', 'hidden answer', { hidden: true }),
      makeMessage('assistant', 'real answer'),
    ]);

    const md = formatConversationAsMarkdown(conv);

    expect(md).toContain('visible question');
    expect(md).not.toContain('hidden answer');
    expect(md).toContain('real answer');
  });

  it('drops messages with empty content after trimming', () => {
    const conv = makeConversation([
      makeMessage('user', '   '),
      makeMessage('assistant', 'answer'),
    ]);

    const md = formatConversationAsMarkdown(conv);

    const userCount = (md.match(/\*\*User:\*\*/g) ?? []).length;
    expect(userCount).toBe(0);
    expect(md).toContain('answer');
  });

  it('returns empty string when no renderable messages remain', () => {
    const conv = makeConversation([
      makeMessage('user', '', { hidden: true }),
    ]);

    expect(formatConversationAsMarkdown(conv)).toBe('');
  });

  it('separates messages with a blank line and terminates with a newline', () => {
    const conv = makeConversation([
      makeMessage('user', 'a'),
      makeMessage('assistant', 'b'),
    ]);

    const md = formatConversationAsMarkdown(conv);

    expect(md.endsWith('\n')).toBe(true);
    // Heading → blank → user block → blank → assistant block → trailing newline
    const userIdx = md.indexOf('**User:**');
    const assistantIdx = md.indexOf('**Assistant:**');
    expect(md.slice(userIdx, assistantIdx)).toContain('\n\n');
  });
});

describe('formatSummaryAsMarkdown', () => {
  it('renders a summary block with the conversation title and body', () => {
    const md = formatSummaryAsMarkdown('Sample chat', 'Short summary body');
    expect(md).toContain('## Obsidian Code 요약 — Sample chat');
    expect(md).toContain('Short summary body');
    expect(md.endsWith('\n')).toBe(true);
  });

  it('trims the summary body', () => {
    const md = formatSummaryAsMarkdown('T', '   body   \n');
    expect(md).toMatch(/body\n$/);
  });

  it('returns empty string for empty summary body', () => {
    expect(formatSummaryAsMarkdown('T', '')).toBe('');
    expect(formatSummaryAsMarkdown('T', '   ')).toBe('');
  });
});
