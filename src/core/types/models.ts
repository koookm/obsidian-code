/**
 * Model type definitions and constants.
 */
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';

import { buildSubprocessEnv } from '../../utils/env';
import { formatModelLabel, parseModelId } from '../models/ModelCatalog';

/** Model identifier (string to support custom models via environment variables). */
export type ClaudeModel = string;

/** Parse and format a raw model list from the Anthropic API response. */
function parseModelList(data: any): { value: string; label: string; description: string }[] | null {
  if (!data?.data || !Array.isArray(data.data)) return null;
  const models = (data.data as any[])
    .filter((m) => typeof m.id === 'string' && m.id.startsWith('claude-'))
    .sort((a, b) => b.id.localeCompare(a.id))
    .map((m) => ({
      value: m.id as string,
      label: (m.display_name as string | undefined) || formatModelLabel(m.id as string),
      description: m.context_window
        ? `컨텍스트 ${Math.round((m.context_window as number) / 1000)}k 토큰`
        : m.id as string,
    }));
  return models.length > 0 ? models : null;
}

/**
 * Fetches the model list the same way the CLI itself resolves it, via the
 * Agent SDK's `supportedModels()` control request — no ANTHROPIC_API_KEY
 * required. This opens a streaming query (required for control requests),
 * asks for the model list over the control channel, and tears the subprocess
 * down again without ever sending a prompt — so it costs nothing and works
 * for subscription (CLI OAuth) auth exactly like a normal chat turn does.
 */
async function fetchModelsViaSDK(
  cliPath: string,
  cwd: string,
  env: Record<string, string>,
  timeoutMs = 15000
): Promise<{ value: string; label: string; description: string }[] | null> {
  if (!cliPath) return null;

  // eslint-disable-next-line require-yield -- streaming input with nothing to send; keeps the control channel open without spending a turn.
  async function* noPrompt(): AsyncGenerator<never> {
    await new Promise<never>(() => { /* never resolves; caller races this against a timeout */ });
  }

  const options: Options = { cwd, pathToClaudeCodeExecutable: cliPath, env };
  const q = agentQuery({ prompt: noPrompt(), options });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const models = await Promise.race([
      q.supportedModels(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);

    const seen = new Set<string>();
    const entries: { value: string; label: string; description: string }[] = [];
    for (const m of models) {
      // 'default' just points at whatever alias the CLI currently favors —
      // skip it so it doesn't shadow the real alias row for that model.
      if (m.value === 'default') continue;
      const id = m.resolvedModel;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      entries.push({
        value: id,
        label: formatModelLabel(id),
        description: m.description || id,
      });
    }
    return entries.length > 0 ? entries : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    // Never sent a message, so there is nothing to interrupt server-side;
    // this just releases the local subprocess.
    try { await q.interrupt(); } catch { /* already gone */ }
    try { await q.return(undefined); } catch { /* already gone */ }
  }
}

/**
 * Fetches the list of available Claude models.
 *
 * Tries ANTHROPIC_API_KEY (direct REST, when the user configured one) first,
 * then falls back to the same auth path regular chat queries use — so
 * subscription (CLI OAuth) users get this working with zero extra setup.
 */
export async function fetchModelsFromCLI(
  cliPath: string,
  envText = '',
  cwd = process.cwd()
): Promise<{ value: string; label: string; description: string }[] | null> {
  const { env, customEnv } = buildSubprocessEnv(envText, cliPath);
  // Only a user-configured key counts here — buildSubprocessEnv already drops a
  // stray OS-level ANTHROPIC_API_KEY unless the user set it explicitly, and
  // regular chat ignores it too, so this stays consistent with what chat sees.
  const apiKey = customEnv.ANTHROPIC_API_KEY;

  // Path 1: API key → direct REST call
  if (apiKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      });
      if (res.ok) {
        const parsed = parseModelList(await res.json());
        if (parsed) return parsed;
      }
    } catch { /* fall through */ }
  }

  // Path 2: same subprocess auth as regular chat (subscription OAuth or API key)
  return fetchModelsViaSDK(cliPath, cwd, env);
}

/**
 * Offline fallback model list.
 *
 * Only used when the Anthropic model list cannot be fetched (no CLI login, no
 * API key, offline). The UI catalog is built from this list the same way it is
 * built from the API response, so new releases surface automatically as soon as
 * the fetch succeeds — this list never needs to be exhaustive.
 */
export const DEFAULT_CLAUDE_MODELS: { value: ClaudeModel; label: string; description: string }[] = [
  { value: 'claude-fable-5',    label: 'Claude Fable 5',    description: '플래그십 — 가장 강력한 모델' },
  { value: 'claude-opus-5',     label: 'Claude Opus 5',     description: 'Opus — 복잡한 작업에 최적' },
  { value: 'claude-opus-4-8',   label: 'Claude Opus 4.8',   description: '이전 Opus' },
  { value: 'claude-sonnet-5',   label: 'Claude Sonnet 5',   description: '성능과 속도의 균형' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: '이전 Sonnet' },
  { value: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5',  description: '가장 빠른 경량 모델' },
];

/** Default model: latest Fable via CLI alias (auto-resolves to the newest version). */
export const DEFAULT_MODEL: ClaudeModel = 'fable';

/** Extended thinking token budget levels. */
export type ThinkingBudget = 'off' | 'low' | 'medium' | 'high' | 'xhigh';

/** Thinking budget configuration with token counts. */
export const THINKING_BUDGETS: { value: ThinkingBudget; label: string; tokens: number }[] = [
  { value: 'off', label: 'Off', tokens: 0 },
  { value: 'low', label: 'Low', tokens: 4000 },
  { value: 'medium', label: 'Med', tokens: 8000 },
  { value: 'high', label: 'High', tokens: 16000 },
  { value: 'xhigh', label: 'Ultra', tokens: 32000 },
];

/**
 * Default thinking budget per model family.
 *
 * Keyed by family rather than by pinned model id so a newly released version
 * inherits its family's budget without a plugin update.
 */
export const FAMILY_THINKING_BUDGET: Record<string, ThinkingBudget> = {
  fable: 'medium',
  opus: 'medium',
  sonnet: 'low',
  haiku: 'off',
};

/** Budget used when a model's family is unknown. */
const FALLBACK_THINKING_BUDGET: ThinkingBudget = 'medium';

/**
 * Resolves the default thinking budget for a model id or CLI alias.
 * Works for any version of a known family (`claude-opus-9`, `opus`, ...).
 */
export function getDefaultThinkingBudget(model: string): ThinkingBudget {
  if (!model) return FALLBACK_THINKING_BUDGET;
  const { family } = parseModelId(model);
  return FAMILY_THINKING_BUDGET[family] ?? FALLBACK_THINKING_BUDGET;
}
