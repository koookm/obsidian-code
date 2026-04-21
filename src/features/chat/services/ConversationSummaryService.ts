/**
 * ObsidianCode - Conversation summary service
 *
 * Runs a lightweight Claude query that condenses a full conversation into
 * a short Markdown block. Mirrors the shape of TitleGenerationService but
 * supports only one active summarization at a time.
 */

import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';

import { CONVERSATION_SUMMARY_SYSTEM_PROMPT } from '../../../core/prompts/conversationSummary';
import type { ChatMessage, Conversation } from '../../../core/types';
import type ObsidianCodePlugin from '../../../main';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';

const MAX_MESSAGES = 40;
const MAX_CHARS_PER_MESSAGE = 800;

export type ConversationSummaryResult =
  | { success: true; summary: string }
  | { success: false; error: string };

/** Service for generating conversation summaries with AI. */
export class ConversationSummaryService {
  private plugin: ObsidianCodePlugin;
  private activeController: AbortController | null = null;

  constructor(plugin: ObsidianCodePlugin) {
    this.plugin = plugin;
  }

  /** Cancels any in-flight summarization. */
  cancel(): void {
    this.activeController?.abort();
    this.activeController = null;
  }

  /** Generates a summary of the given conversation. */
  async summarize(conversation: Conversation): Promise<ConversationSummaryResult> {
    const vaultPath = getVaultPath(this.plugin.app);
    if (!vaultPath) {
      return { success: false, error: 'Could not determine vault path' };
    }

    const resolvedClaudePath = this.plugin.getResolvedClaudeCliPath();
    if (!resolvedClaudePath) {
      return { success: false, error: 'Claude CLI not found' };
    }

    const transcript = this.buildTranscript(conversation.messages);
    if (!transcript) {
      return { success: false, error: 'No messages to summarize' };
    }

    const envVars = parseEnvironmentVariables(
      this.plugin.getActiveEnvironmentVariables()
    );

    const summaryModel =
      this.plugin.settings.titleGenerationModel ||
      envVars.ANTHROPIC_DEFAULT_HAIKU_MODEL ||
      'claude-haiku-4-5';

    this.activeController?.abort();
    const abortController = new AbortController();
    this.activeController = abortController;

    const options: Options = {
      cwd: vaultPath,
      systemPrompt: CONVERSATION_SUMMARY_SYSTEM_PROMPT,
      model: summaryModel,
      abortController,
      pathToClaudeCodeExecutable: resolvedClaudePath,
      env: {
        ...process.env,
        ...envVars,
        PATH: getEnhancedPath(envVars.PATH, resolvedClaudePath),
      },
      allowedTools: [],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    };

    const prompt = `Conversation title: ${conversation.title}\n\nTranscript:\n${transcript}\n\nSummarize the conversation above.`;

    try {
      const response = agentQuery({ prompt, options });
      let responseText = '';

      for await (const message of response) {
        if (abortController.signal.aborted) {
          return { success: false, error: 'Cancelled' };
        }
        const text = this.extractTextFromMessage(message);
        if (text) responseText += text;
      }

      const summary = responseText.trim();
      if (!summary) {
        return { success: false, error: 'Empty response from model' };
      }
      return { success: true, summary };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: 'Cancelled' };
      }
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[ConversationSummary] Error:', msg);
      return { success: false, error: msg };
    } finally {
      if (this.activeController === abortController) {
        this.activeController = null;
      }
    }
  }

  private buildTranscript(messages: ChatMessage[]): string {
    const visible = messages.filter((m) => !m.hidden && (m.displayContent ?? m.content).trim());
    const recent = visible.slice(-MAX_MESSAGES);
    return recent
      .map((m) => {
        const label = m.role === 'user' ? 'User' : 'Assistant';
        const text = (m.displayContent ?? m.content).trim();
        const truncated = text.length > MAX_CHARS_PER_MESSAGE
          ? text.slice(0, MAX_CHARS_PER_MESSAGE) + '…'
          : text;
        return `${label}: ${truncated}`;
      })
      .join('\n\n');
  }

  private extractTextFromMessage(
    message: { type: string; message?: { content?: Array<{ type: string; text?: string }> } }
  ): string {
    if (message.type !== 'assistant' || !message.message?.content) return '';
    return message.message.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text' && !!b.text)
      .map((b) => b.text)
      .join('');
  }
}
