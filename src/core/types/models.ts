/**
 * Model type definitions and constants.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

import { formatModelLabel, parseModelId } from '../models/ModelCatalog';

const execFileAsync = promisify(execFile);

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
 * Fetches the list of available Claude models.
 * Tries ANTHROPIC_API_KEY (direct REST) first, then falls back to CLI OAuth
 * (subscription users authenticated via `claude login`).
 */
export async function fetchModelsFromCLI(
  cliPath: string
): Promise<{ value: string; label: string; description: string }[] | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  // Path 1: API key → direct REST call
  if (apiKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      });
      if (res.ok) return parseModelList(await res.json());
    } catch { /* fall through */ }
  }

  // Path 2: CLI OAuth (subscription) → proxy via `claude api get /v1/models`
  if (cliPath) {
    try {
      const { stdout } = await execFileAsync(cliPath, ['api', 'get', '/v1/models'], {
        timeout: 10000,
      });
      return parseModelList(JSON.parse(stdout));
    } catch { /* fall through */ }
  }

  return null;
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
