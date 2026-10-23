import { ClaudeAgents, DEFAULT_MODEL } from './claude';
import type { AgentSuite } from './types';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/**
 * Claude-backed agents when an Anthropic credential is configured; null otherwise (the
 * pipeline then skips the debate and writes memos from the ledger template).
 */
export function buildAgents(env: Record<string, string | undefined>): AgentSuite | null {
  if (!env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) return null;
  const effort = EFFORTS.find((e) => e === env.LLM_EFFORT) ?? 'high';
  return new ClaudeAgents({
    model: env.LLM_MODEL || DEFAULT_MODEL,
    effort,
    fallbacks: env.LLM_FALLBACKS !== 'off',
  });
}
