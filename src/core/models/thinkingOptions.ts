/**
 * ObsidianCode - Thinking option shaping for the Claude Agent SDK.
 *
 * The SDK deprecated `maxThinkingTokens` in favour of a `thinking` config:
 *
 *   - `{ type: 'adaptive' }`                     — the model decides how much to think
 *   - `{ type: 'enabled', budgetTokens: N }`     — fixed budget (older models)
 *   - `{ type: 'disabled' }`                     — no extended thinking
 *
 * We emit the new field and keep `maxThinkingTokens` alongside it, so the
 * plugin behaves correctly against both old and new Claude CLI builds. When
 * both are present the SDK honours `thinking`.
 */

import type { ThinkingBudget } from '../types/models';
import { THINKING_BUDGETS } from '../types/models';

/** The SDK's thinking config shape, declared locally to stay SDK-version agnostic. */
export type SdkThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' };

/** Thinking-related SDK options derived from a budget setting. */
export interface ThinkingOptions {
  thinking: SdkThinkingConfig;
  /** Deprecated SDK field, kept so older CLI builds still get a budget. */
  maxThinkingTokens?: number;
}

/**
 * Maps a plugin thinking budget onto SDK options.
 *
 * `off` disables thinking outright. Every other level asks for a fixed budget,
 * which preserves the token counts the selector advertises ("Med" = 8k).
 */
export function getThinkingOptions(budget: ThinkingBudget): ThinkingOptions {
  const config = THINKING_BUDGETS.find((b) => b.value === budget);
  const tokens = config?.tokens ?? 0;

  if (tokens <= 0) {
    return { thinking: { type: 'disabled' } };
  }

  return {
    thinking: { type: 'enabled', budgetTokens: tokens },
    maxThinkingTokens: tokens,
  };
}

/**
 * Applies thinking options onto an SDK options object.
 *
 * `options` is typed loosely because `thinking` only exists on newer SDK
 * versions; assigning it on an older type would not compile.
 */
export function applyThinkingOptions(
  options: Record<string, unknown>,
  budget: ThinkingBudget
): void {
  const { thinking, maxThinkingTokens } = getThinkingOptions(budget);
  options.thinking = thinking;
  if (maxThinkingTokens !== undefined) {
    options.maxThinkingTokens = maxThinkingTokens;
  }
}
