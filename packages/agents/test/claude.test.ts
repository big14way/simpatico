import { describe, expect, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { ClaudeAgents } from '../src/claude';
import { buildAgents } from '../src/build';
import type { CallMeta, DebateInput, LlmCache, LlmCacheEntry } from '../src/types';

type Call = Record<string, unknown>;

function fakeClient(responder: (kind: 'parse' | 'create', params: Call) => unknown) {
  const calls: { kind: string; params: Call }[] = [];
  const client = {
    beta: {
      messages: {
        parse: async (params: Call) => {
          calls.push({ kind: 'parse', params });
          return responder('parse', params);
        },
        create: async (params: Call) => {
          calls.push({ kind: 'create', params });
          return responder('create', params);
        },
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

const debate: DebateInput = {
  side: 'bear',
  dealType: 'ma_bolt_on',
  buyerName: 'Buyer',
  targetName: 'Target',
  evidence: [{ id: 't1-m1', label: 'm1', data: { value: 0.6 } }],
  flags: [{ flag: 'FADING', rule: 'z < -1.5' }],
  score: { F: 61.2, coverage: 0.9 },
};

describe('ClaudeAgents', () => {
  it('asks for structured claims on claude-opus-5-5 with adaptive thinking, effort and fallbacks', async () => {
    const { client, calls } = fakeClient(() => ({
      stop_reason: 'end_turn',
      parsed_output: { claims: [{ text: 'Fading.', flag: 'FADING', cites: [{ evidenceId: 't1-m1', path: 'value', value: 0.6 }] }, { text: 'Thin overlap.', flag: 'NONE', cites: [] }] },
    }));
    const agents = new ClaudeAgents({ client });
    const claims = await agents.argue(debate);
    expect(claims).toEqual([
      { text: 'Fading.', direction: '-', flag: 'FADING', cites: [{ evidenceId: 't1-m1', path: 'value', value: 0.6 }] },
      { text: 'Thin overlap.', direction: '-', flag: null, cites: [] },
    ]);
    const p = calls[0]!.params;
    expect(p.model).toBe('claude-opus-5-5');
    expect(p.thinking).toEqual({ type: 'adaptive' });
    expect(p.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(p.fallbacks).toBe('default');
    expect((p.output_config as { effort: string }).effort).toBe('high');
    expect(p).not.toHaveProperty('temperature');
    expect(String(p.system)).toContain('AGAINST');
  });

  it('turns refusals and missing output into errors instead of empty claims', async () => {
    const refusing = new ClaudeAgents({ client: fakeClient(() => ({ stop_reason: 'refusal', stop_details: { category: 'cyber' } })).client });
    await expect(refusing.argue(debate)).rejects.toThrow(/declined \(cyber\)/);
    const empty = new ClaudeAgents({ client: fakeClient(() => ({ stop_reason: 'end_turn', parsed_output: null })).client });
    await expect(empty.argue(debate)).rejects.toThrow(/no structured output/);
  });

  it('retries once without fallbacks when the account rejects the beta', async () => {
    let n = 0;
    const { client, calls } = fakeClient(() => {
      n++;
      if (n === 1) throw new Anthropic.BadRequestError(400, { type: 'error' }, 'fallbacks not enabled', new Headers());
      return { stop_reason: 'end_turn', parsed_output: { subject: 'Hi', body: 'Hello' } };
    });
    const out = await new ClaudeAgents({ client }).draftOutreach({ dealType: 'licensing', buyerName: 'B', targetName: 'T', facts: [] });
    expect(out).toEqual({ subject: 'Hi', body: 'Hello' });
    expect(calls[1]!.params).not.toHaveProperty('fallbacks');
    expect((calls[0]!.params.output_config as { effort: string }).effort).toBe('low');
  });

  it('memo text comes from text blocks only', async () => {
    const { client } = fakeClient(() => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '## Memo' }] }));
    expect(await new ClaudeAgents({ client }).writeMemo({
      dealType: 'ma_bolt_on', buyerName: 'B', title: 't', momentumAsOf: '2026-10-23', shortlistSize: 3,
      target: { key: 't1', name: 'T', verdict: 'WATCH', why: 'x', F: 60, rank: 1, evidence: [], acceptedClaims: [], diligenceQuestions: [] },
    })).toBe('## Memo');
  });

  it('keeps the no-Qloo ranking a permutation of the candidates', async () => {
    const { client } = fakeClient(() => ({ stop_reason: 'end_turn', parsed_output: { ranking: ['b', 'Zed', 'A', 'B'], notes: 'n' } }));
    const r = await new ClaudeAgents({ client }).rankWithoutQloo({ dealType: 'vc_thesis', buyerName: 'X', proxies: [], candidates: ['A', 'B', 'C'] });
    expect(r.ranking).toEqual(['B', 'A', 'C']);
    expect(r.notes).toMatch(/omitted 1/);
  });
});

function memoryCache() {
  const rows = new Map<string, LlmCacheEntry>();
  const cache: LlmCache = {
    get: async (k) => rows.get(k) ?? null,
    put: async (k, e) => void rows.set(k, e),
  };
  return { cache, rows };
}

describe('stored answers', () => {
  const answer = { stop_reason: 'end_turn', model: 'claude-opus-5-5', usage: { input_tokens: 7000, output_tokens: 900 }, parsed_output: { claims: [{ text: 'Fading.', flag: 'FADING', cites: [] }] } };

  it('answers an identical request from the cache and says so', async () => {
    const { cache, rows } = memoryCache();
    const { client, calls } = fakeClient(() => answer);
    const agents = new ClaudeAgents({ client, cache });
    const first: CallMeta = {};
    const a = await agents.argue(debate, first);
    expect(first.cached).toBeUndefined();
    expect([...rows.values()][0]).toMatchObject({ kind: 'argue:bear', model: 'claude-opus-5-5', usage: { inputTokens: 7000, outputTokens: 900 } });
    const second: CallMeta = {};
    expect(await agents.argue(debate, second)).toEqual(a);
    expect(second.cached).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('misses when the evidence, side or effort differ', async () => {
    const { cache, rows } = memoryCache();
    const { client, calls } = fakeClient(() => answer);
    await new ClaudeAgents({ client, cache }).argue(debate);
    await new ClaudeAgents({ client, cache }).argue({ ...debate, evidence: [{ id: 't1-m1', label: 'm1', data: { value: 0.61 } }] });
    await new ClaudeAgents({ client, cache }).argue({ ...debate, side: 'bull' });
    await new ClaudeAgents({ client, cache, effort: 'low' }).argue(debate);
    expect(calls).toHaveLength(4);
    expect(rows.size).toBe(4);
  });

  it('ignores a stored answer that no longer fits the schema, and survives a broken cache', async () => {
    const { cache, rows } = memoryCache();
    const { client, calls } = fakeClient(() => answer);
    await new ClaudeAgents({ client, cache }).argue(debate);
    for (const [k, e] of rows) rows.set(k, { ...e, output: { claims: 'not a list' } });
    await new ClaudeAgents({ client, cache }).argue(debate);
    expect(calls).toHaveLength(2);
    const broken: LlmCache = { get: async () => { throw new Error('db down'); }, put: async () => { throw new Error('db down'); } };
    expect(await new ClaudeAgents({ client, cache: broken }).argue(debate)).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });

  it('stores memo text too', async () => {
    const { cache } = memoryCache();
    const { client, calls } = fakeClient(() => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '## Memo' }] }));
    const input = {
      dealType: 'ma_bolt_on' as const, buyerName: 'B', title: 't', momentumAsOf: '2026-10-23', shortlistSize: 3,
      target: { key: 't1', name: 'T', verdict: 'WATCH', why: 'x', F: 60, rank: 1, evidence: [], acceptedClaims: [], diligenceQuestions: [] },
    };
    const agents = new ClaudeAgents({ client, cache });
    await agents.writeMemo(input);
    const meta: CallMeta = {};
    expect(await agents.writeMemo(input, meta)).toBe('## Memo');
    expect(meta.cached).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe('buildAgents', () => {
  it('is null without an Anthropic credential and honours model/effort env', () => {
    expect(buildAgents({})).toBeNull();
    const a = buildAgents({ ANTHROPIC_API_KEY: 'test-key', LLM_MODEL: 'claude-sonnet-5-5', LLM_EFFORT: 'medium' });
    expect(a!.model).toBe('claude-sonnet-5-5');
  });

  it('uses the cache it is given unless LLM_CACHE=off', () => {
    const { cache } = memoryCache();
    expect((buildAgents({ ANTHROPIC_API_KEY: 'k' }, { cache }) as unknown as { cache: unknown }).cache).toBe(cache);
    expect((buildAgents({ ANTHROPIC_API_KEY: 'k', LLM_CACHE: 'off' }, { cache }) as unknown as { cache: unknown }).cache).toBeNull();
  });
});
