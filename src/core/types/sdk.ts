/**
 * Claude Agent SDK type definitions.
 */

/** SDK content block structure. */
export interface SDKContentBlock {
  /**
   * Block kind. The SDK keeps adding kinds (`image`, `document`, ...), so this
   * stays a plain string; the four the plugin renders are called out for
   * discoverability.
   */
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | (string & {});
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | unknown;
  is_error?: boolean;
}

/**
 * SDK message content wrapper.
 *
 * `content` is a plain string on user messages built from a bare prompt, and an
 * array of blocks otherwise. Use {@link toContentBlocks} to normalize it.
 */
export interface SDKMessageContent {
  content?: string | SDKContentBlock[];
}

/** Normalizes SDK message content to blocks, wrapping the bare-string form. */
export function toContentBlocks(
  content: string | SDKContentBlock[] | undefined
): SDKContentBlock[] {
  if (!content) return [];
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return content;
}

/** SDK stream event structure. */
export interface SDKStreamEvent {
  /**
   * Streaming event kind. The SDK emits the full Anthropic stream vocabulary
   * (`message_start`, `content_block_stop`, ...); the plugin only acts on the
   * two named here, so the rest stay assignable rather than breaking the type.
   */
  type: 'content_block_start' | 'content_block_delta' | (string & {});
  index?: number;
  content_block?: SDKContentBlock;
  delta?: {
    /** Absent on message-level deltas, which the plugin ignores. */
    type?: 'text_delta' | 'thinking_delta' | (string & {});
    text?: string;
    thinking?: string;
  };
}

/** Model usage information from SDK. */
export interface ModelUsageInfo {
  inputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  contextWindow?: number;
}

/** SDK message structure from the Claude Agent SDK. */
export interface SDKMessage {
  type: 'system' | 'assistant' | 'user' | 'stream_event' | 'result' | 'error' | 'tool_progress' | 'auth_status';
  subtype?: 'init' | 'compact_boundary' | 'status' | 'hook_response' | string;
  session_id?: string;
  message?: SDKMessageContent;
  tool_use_result?: string | unknown;
  parent_tool_use_id?: string | null;
  event?: SDKStreamEvent;
  error?: string;
  tool_use_id?: string;
  tool_name?: string;
  elapsed_time_seconds?: number;
  isAuthenticating?: boolean;
  output?: string[];
  /** Usage info by model name. */
  modelUsage?: Record<string, ModelUsageInfo>;
  /** Model name for the message. */
  model?: string;
}
