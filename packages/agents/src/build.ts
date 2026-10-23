import type { AgentSuite } from './types';

/** Builds the LLM-backed agents from env; null when no model is configured. */
export function buildAgents(_env: Record<string, string | undefined>): AgentSuite | null {
  return null;
}
