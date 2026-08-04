/**
 * Shared text extraction for one-shot SDK queries (titles, summaries, refines).
 */

/** Minimal shape of an SDK message this helper needs. */
export interface TextExtractableMessage {
  type: string;
  /**
   * Blocks, a bare string when the SDK built the message from a plain prompt,
   * or a plain string on messages like permission-denied. All forms appear on
   * the stream, so all are handled here.
   */
  message?: string | {
    content?: string | Array<{ type: string; text?: string }>;
  };
}

/** Concatenates the text blocks of an assistant message; '' for anything else. */
export function extractAssistantText(message: TextExtractableMessage): string {
  if (message.type !== 'assistant') return '';

  const envelope = message.message;
  if (typeof envelope === 'string') return '';

  const content = envelope?.content;
  if (!content) return '';
  if (typeof content === 'string') return content;

  return content
    .filter((block): block is { type: 'text'; text: string } =>
      block.type === 'text' && !!block.text
    )
    .map((block) => block.text)
    .join('');
}
