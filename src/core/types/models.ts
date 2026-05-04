/**
 * Model type definitions and constants.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

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
      label: (m.display_name as string | undefined) ||
        (m.id as string)
          .replace(/^claude-/, 'Claude ')
          .replace(/-(\d)/g, ' $1')
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (c: string) => c.toUpperCase()),
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

/** Default Claude model options. */
export const DEFAULT_CLAUDE_MODELS: { value: ClaudeModel; label: string; description: string }[] = [
  // --- Claude 4.7 (최신) ---
  { value: 'claude-opus-4-7',   label: 'Claude Opus 4.7',   description: '최신 Opus — 복잡한 작업에 최적' },
  // --- Claude 4.6 ---
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: '성능과 속도의 균형 — 일반 작업 권장' },
  // --- CLI 별칭 (항상 최신 버전으로 자동 해석) ---
  { value: 'haiku',  label: 'Haiku (Latest)',  description: 'Always points to the latest Haiku via CLI' },
  { value: 'sonnet', label: 'Sonnet (Latest)', description: 'Always points to the latest Sonnet via CLI' },
  { value: 'opus',   label: 'Opus (Latest)',   description: 'Always points to the latest Opus via CLI' },
];

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

/** Default thinking budget per model tier. */
export const DEFAULT_THINKING_BUDGET: Record<string, ThinkingBudget> = {
  // CLI 별칭
  'haiku': 'off',
  'sonnet': 'low',
  'opus': 'medium',
  // Claude 4.7
  'claude-opus-4-7': 'medium',
  // Claude 4.6
  'claude-sonnet-4-6': 'low',
};
