import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { RED_FLAGS, type Claim } from '@simpatico/core';
import { bearSystem, bullSystem, debateUser, memoSystem, memoUser, noQlooSystem, noQlooUser, outreachSystem, outreachUser } from './prompts';
import type { AblationRankInput, AgentSuite, DebateInput, MemoInput, OutreachInput } from './types';

export const DEFAULT_MODEL = 'claude-opus-5-5';
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const CiteSchema = z.object({
  evidenceId: z.string().describe('row id from the evidence pack, e.g. "t3-m1"'),
  path: z.string().describe('path into that row\'s data, e.g. "value" or "domains[0].score"'),
  value: z.number().describe('the number at that path, copied exactly'),
});
const ClaimsSchema = z.object({
  claims: z.array(
    z.object({
      text: z.string().describe('one or two sentences'),
      flag: z.enum([...RED_FLAGS, 'NONE']).describe('a red flag this claim surfaces (bear) or mitigates (bull); NONE otherwise'),
      cites: z.array(CiteSchema),
    }),
  ),
});
const OutreachSchema = z.object({ subject: z.string(), body: z.string() });
const RankingSchema = z.object({
  ranking: z.array(z.string()).describe('every candidate name exactly as given, best fit first'),
  notes: z.string().describe('one short paragraph on how you ranked'),
});

export interface ClaudeAgentsOptions {
  client?: Anthropic;
  model?: string;
  /** effort for debate and memos (default high: citation accuracy matters) */
  effort?: Effort;
  /** server-side refusal fallbacks (on by default) */
  fallbacks?: boolean;
}

/** Bull, bear, memo writer, outreach drafter and the no-Qloo ranker, on Claude. */
export class ClaudeAgents implements AgentSuite {
  readonly model: string;
  private readonly client: Anthropic;
  private readonly modelId: string;
  private readonly effort: Effort;
  private fallbacks: boolean;

  constructor(opts: ClaudeAgentsOptions = {}) {
    this.client = opts.client ?? new Anthropic({ timeout: 180_000, maxRetries: 2 });
    this.modelId = opts.model ?? DEFAULT_MODEL;
    this.effort = opts.effort ?? 'high';
    this.fallbacks = opts.fallbacks ?? true;
    this.model = this.modelId;
  }

  private base(effort: Effort) {
    return {
      model: this.modelId,
      max_tokens: 16000,
      thinking: { type: 'adaptive' as const },
      ...(this.fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      effort,
    };
  }

  /** Retries once without fallbacks if the account rejects the fallback beta. */
  private async withFallbackGuard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (this.fallbacks && err instanceof Anthropic.BadRequestError) {
        this.fallbacks = false;
        return await fn();
      }
      throw err;
    }
  }

  private async structured<S extends z.ZodType>(schema: S, system: string, user: string, effort: Effort): Promise<z.infer<S>> {
    return this.withFallbackGuard(async () => {
      const { effort: e, ...rest } = this.base(effort);
      const res = await this.client.beta.messages.parse({
        ...rest,
        output_config: { effort: e, format: betaZodOutputFormat(schema) },
        system,
        messages: [{ role: 'user', content: user }],
      });
      if (res.stop_reason === 'refusal') throw new Error(`model declined${res.stop_details?.category ? ` (${res.stop_details.category})` : ''}`);
      if (res.stop_reason === 'max_tokens') throw new Error('model hit max_tokens');
      if (!res.parsed_output) throw new Error('model returned no structured output');
      return res.parsed_output as z.infer<S>;
    });
  }

  private async text(system: string, user: string, effort: Effort): Promise<string> {
    return this.withFallbackGuard(async () => {
      const { effort: e, ...rest } = this.base(effort);
      const res = await this.client.beta.messages.create({
        ...rest,
        output_config: { effort: e },
        system,
        messages: [{ role: 'user', content: user }],
      });
      if (res.stop_reason === 'refusal') throw new Error(`model declined${res.stop_details?.category ? ` (${res.stop_details.category})` : ''}`);
      if (res.stop_reason === 'max_tokens') throw new Error('model hit max_tokens');
      const out = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
      if (!out) throw new Error('model returned no text');
      return out;
    });
  }

  async argue(input: DebateInput): Promise<Claim[]> {
    const system = input.side === 'bull' ? bullSystem(input) : bearSystem(input);
    const out = await this.structured(ClaimsSchema, system, debateUser(input), this.effort);
    return out.claims.map((c) => ({
      text: c.text,
      direction: input.side === 'bull' ? '+' : '-',
      flag: c.flag === 'NONE' ? null : c.flag,
      cites: c.cites,
    }));
  }

  async writeMemo(input: MemoInput): Promise<string> {
    return this.text(memoSystem(input), memoUser(input), this.effort);
  }

  async draftOutreach(input: OutreachInput): Promise<{ subject: string; body: string }> {
    return this.structured(OutreachSchema, outreachSystem(input), outreachUser(input), 'low');
  }

  async rankWithoutQloo(input: AblationRankInput): Promise<{ ranking: string[]; notes: string }> {
    const out = await this.structured(RankingSchema, noQlooSystem(input), noQlooUser(input), this.effort);
    // keep it a permutation of the candidates: drop unknown names, append any it skipped
    const wanted = new Map(input.candidates.map((c) => [c.toLowerCase(), c]));
    const seen = new Set<string>();
    const ranking: string[] = [];
    for (const n of out.ranking) {
      const c = wanted.get(n.trim().toLowerCase());
      if (c && !seen.has(c)) {
        seen.add(c);
        ranking.push(c);
      }
    }
    const skipped = input.candidates.filter((c) => !seen.has(c));
    return { ranking: [...ranking, ...skipped], notes: skipped.length ? `${out.notes} (model omitted ${skipped.length}; appended in input order)` : out.notes };
  }
}

