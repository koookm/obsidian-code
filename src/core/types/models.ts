/**
 * Model type definitions and constants.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
 * Fetches the list of available Claude models from the Anthropic API.
 * Requires ANTHROPIC_API_KEY — Anthropic's REST API does not support OAuth tokens.
 * Returns null if no API key is available or the request fails.
 */
export async function fetchModelsFromCLI(
  _cliPath: string
): Promise<{ value: string; label: string; description: string }[] | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (!res.ok) return null;
    return parseModelList(await res.json());
  } catch {
    return null;
  }
}

/** Default Claude model options. */
export const DEFAULT_CLAUDE_MODELS: { value: ClaudeModel; label: string; description: string }[] = [
  // --- Claude 4.6 (최신) ---
  { value: 'claude-opus-4-6',   label: 'Claude Opus 4.6',   description: '가장 강력한 모델 — 복잡한 작업에 최적' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: '성능과 속도의 균형 — 일반 작업 권장' },
  // --- Claude 4.5 ---
  { value: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5',  description: '빠르고 가벼운 모델 — 간단한 작업에 적합' },
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', description: 'Sonnet 이전 버전' },
  { value: 'claude-opus-4-5',   label: 'Claude Opus 4.5',   description: 'Opus 이전 버전' },
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
  // Claude 4.6
  'claude-opus-4-6': 'medium',
  'claude-sonnet-4-6': 'low',
  // Claude 4.5
  'claude-haiku-4-5': 'off',
  'claude-sonnet-4-5': 'low',
  'claude-opus-4-5': 'medium',
};
