import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { RED_FLAGS, type Claim } from '@simpatico/core';
import { bearSystem, bullSystem, debateUser, memoSystem, memoUser, noQlooSystem, noQlooUser, outreachSystem, outreachUser } from './prompts';
import type { AblationRankInput, AgentSuite, CallMeta, DebateInput, LlmCache, LlmCacheEntry, MemoInput, OutreachInput } from './types';

/** debate, memos and outreach: the code judge and the memo number check catch what a small model gets wrong */
export const DEFAULT_MODEL = 'claude-haiku-5-5';
/** the no-Qloo ablation ranker: the comparison is against the strongest model, not the cheapest */
export const DEFAULT_RANKER_MODEL = 'claude-opus-5-5';
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
type Call = { model: string; effort: Effort };
/** bump to invalidate every stored answer (for example after a change in how answers are post-processed) */
const CACHE_VERSION = 1;

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
/** an answer that parsed but can't be used (for example a ranking that skips most candidates) */
export class UnusableAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnusableAnswerError';
  }
}

const RankingSchema = z.object({
  ranking: z.array(z.string()).describe('every candidate name exactly as given, best fit first'),
  notes: z.string().describe('one short paragraph on how you ranked'),
});

export interface ClaudeAgentsOptions {
  client?: Anthropic;
  model?: string;
  /** model for the no-Qloo ablation ranking (default DEFAULT_RANKER_MODEL) */
  rankerModel?: string;
  /** effort for debate and memos (default high: citation accuracy matters) */
  effort?: Effort;
  /** server-side refusal fallbacks (on by default) */
  fallbacks?: boolean;
  /** stored answers: an identical request (model, effort, prompts, schema) is answered from here */
  cache?: LlmCache;
}

/** Bull, bear, memo writer, outreach drafter and the no-Qloo ranker, on Claude. */
export class ClaudeAgents implements AgentSuite {
  readonly model: string;
  readonly rankerModel: string;
  private readonly client: Anthropic;
  private readonly effort: Effort;
  private fallbacks: boolean;
  private readonly cache: LlmCache | null;

  constructor(opts: ClaudeAgentsOptions = {}) {
    this.client = opts.client ?? new Anthropic({ timeout: 180_000, maxRetries: 2 });
    this.model = opts.model ?? DEFAULT_MODEL;
    this.rankerModel = opts.rankerModel ?? DEFAULT_RANKER_MODEL;
    this.effort = opts.effort ?? 'high';
    this.fallbacks = opts.fallbacks ?? true;
    this.cache = opts.cache ?? null;
  }

  private cacheKey(kind: string, format: unknown, system: string, user: string, call: Call): string {
    const parts = { v: CACHE_VERSION, kind, model: call.model, effort: call.effort, format, system, user };
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  }

  /** A cache that fails is a miss, never a failed call. */
  private async recall(key: string): Promise<LlmCacheEntry | null> {
    try {
      return (await this.cache?.get(key)) ?? null;
    } catch (err) {
      console.warn(`llm cache read failed: ${(err as Error).message}`);
      return null;
    }
  }

  private async remember(key: string, entry: LlmCacheEntry): Promise<void> {
    try {
      await this.cache?.put(key, entry);
    } catch (err) {
      console.warn(`llm cache write failed: ${(err as Error).message}`);
    }
  }

  private base(call: Call) {
    return {
      model: call.model,
      max_tokens: 16000,
      thinking: { type: 'adaptive' as const },
      ...(this.fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      effort: call.effort,
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

  /** `problem` names what makes a parsed answer unusable; such an answer is neither stored nor replayed. */
  private async structured<S extends z.ZodType>(
    kind: string,
    schema: S,
    system: string,
    user: string,
    call: Call,
    meta?: CallMeta,
    problem?: (out: z.infer<S>) => string | null,
  ): Promise<z.infer<S>> {
    const key = this.cache ? this.cacheKey(kind, z.toJSONSchema(schema), system, user, call) : null;
    if (key) {
      const hit = await this.recall(key);
      const parsed = hit ? schema.safeParse(hit.output) : null;
      if (parsed?.success && !problem?.(parsed.data)) {
        if (meta) meta.cached = true;
        return parsed.data;
      }
    }
    const out = await this.withFallbackGuard(async () => {
      const { effort: e, ...rest } = this.base(call);
      const res = await this.client.beta.messages.parse({
        ...rest,
        output_config: { effort: e, format: betaZodOutputFormat(schema) },
        system,
        messages: [{ role: 'user', content: user }],
      });
      if (res.stop_reason === 'refusal') throw new Error(`model declined${res.stop_details?.category ? ` (${res.stop_details.category})` : ''}`);
      if (res.stop_reason === 'max_tokens') throw new Error('model hit max_tokens');
      if (!res.parsed_output) throw new Error('model returned no structured output');
      return { output: res.parsed_output as z.infer<S>, model: res.model, usage: res.usage };
    });
    const unusable = problem?.(out.output);
    if (unusable) throw new UnusableAnswerError(unusable);
    if (key) await this.remember(key, { kind, model: out.model ?? call.model, output: out.output, usage: tokens(out.usage) });
    return out.output;
  }

  private async text(kind: string, system: string, user: string, call: Call, meta?: CallMeta): Promise<string> {
    const key = this.cache ? this.cacheKey(kind, 'text', system, user, call) : null;
    if (key) {
      const hit = await this.recall(key);
      if (typeof hit?.output === 'string' && hit.output.trim()) {
        if (meta) meta.cached = true;
        return hit.output;
      }
    }
    const res = await this.withFallbackGuard(async () => {
      const { effort: e, ...rest } = this.base(call);
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
      return { output: out, model: res.model, usage: res.usage };
    });
    if (key) await this.remember(key, { kind, model: res.model ?? call.model, output: res.output, usage: tokens(res.usage) });
    return res.output;
  }

  async argue(input: DebateInput, meta?: CallMeta): Promise<Claim[]> {
    const system = input.side === 'bull' ? bullSystem(input) : bearSystem(input);
    const out = await this.structured(`argue:${input.side}`, ClaimsSchema, system, debateUser(input), { model: this.model, effort: this.effort }, meta);
    return out.claims.map((c) => ({
      text: c.text,
      direction: input.side === 'bull' ? '+' : '-',
      flag: c.flag === 'NONE' ? null : c.flag,
      cites: c.cites,
    }));
  }

  async writeMemo(input: MemoInput, meta?: CallMeta): Promise<string> {
    return this.text('memo', memoSystem(input), memoUser(input), { model: this.model, effort: this.effort }, meta);
  }

  async draftOutreach(input: OutreachInput, meta?: CallMeta): Promise<{ subject: string; body: string }> {
    return this.structured('outreach', OutreachSchema, outreachSystem(input), outreachUser(input), { model: this.model, effort: 'low' }, meta);
  }

  async rankWithoutQloo(input: AblationRankInput, meta?: CallMeta): Promise<{ ranking: string[]; notes: string }> {
    const wanted = new Map(input.candidates.map((c) => [c.toLowerCase(), c]));
    // a ranking that skips most candidates would be scored as input order: reject it and ask once more
    const need = input.candidates.length - Math.max(1, Math.floor(0.2 * input.candidates.length));
    const incomplete = (o: { ranking: string[] }) => {
      const n = new Set(o.ranking.map((x) => wanted.get(x.trim().toLowerCase())).filter(Boolean)).size;
      return n < need ? `model ranked only ${n} of ${input.candidates.length} candidates` : null;
    };
    const ask = () => this.structured('rank-no-qloo', RankingSchema, noQlooSystem(input), noQlooUser(input), { model: this.rankerModel, effort: this.effort }, meta, incomplete);
    let out: z.infer<typeof RankingSchema>;
    try {
      out = await ask();
    } catch (err) {
      if (!(err instanceof UnusableAnswerError)) throw err;
      out = await ask();
    }
    // keep it a permutation of the candidates: drop unknown names, append any it skipped
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

function tokens(u: { input_tokens?: number | null; output_tokens?: number | null } | null | undefined): LlmCacheEntry['usage'] {
  return u ? { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 } : null;
}
