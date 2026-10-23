import { z } from 'zod';
import { DEAL_TYPES } from '@simpatico/core';

const nameRef = z.object({
  name: z.string().trim().min(1).max(120),
  /** set once resolved (or confirmed by the user) */
  entityId: z.string().trim().min(1).max(64).optional(),
});

export const MandateSchema = z.object({
  title: z.string().trim().max(160).optional(),
  dealType: z.enum(DEAL_TYPES),
  /** the acquirer / licensor / thesis anchor; must be a Qloo brand entity */
  buyer: nameRef,
  /** owned brands, flagship products: they enrich the buyer's audience signal */
  proxies: z.array(nameRef).max(6).default([]),
  /** candidate brands (pasted list or CSV); pin = always analyse, even outside the top k */
  universe: z.array(nameRef.extend({ pin: z.boolean().optional() })).max(60).default([]),
  discover: z
    .object({
      enabled: z.boolean().default(false),
      /** Qloo brand-genre tag ids from /v2/tags */
      categoryTags: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })).max(5).default([]),
      /** cap on Qloo popularity (0-1) so discovery surfaces emerging brands, not giants */
      popularityMax: z.number().min(0).max(1).optional(),
      take: z.number().int().min(1).max(30).default(15),
    })
    .default({ enabled: false, categoryTags: [], take: 15 }),
  /** drop targets whose Qloo ultimate parent is the buyer's parent */
  excludeOwned: z.boolean().default(true),
  /**
   * drop targets Qloo lists under another parent group (not acquirable, not venture-stage).
   * Unset = by deal type: on for M&A and VC theses, off for licensing (a collab works with any owner).
   */
  excludeGroupOwned: z.boolean().optional(),
  shortlistSize: z.number().int().min(1).max(12).default(8),
  /** entity ids always carried into the shortlist */
  pinned: z.array(z.string()).max(12).default([]),
  /** momentum window end (YYYY-MM-DD); defaults to the run date */
  momentumAsOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  region: z.literal('United States').default('United States'),
  notes: z.string().max(2000).optional(),
});

export type Mandate = z.infer<typeof MandateSchema>;
export type MandateInput = z.input<typeof MandateSchema>;

export function parseMandate(input: unknown): Mandate {
  const m = MandateSchema.parse(input);
  const total = m.universe.length + (m.discover.enabled ? m.discover.take : 0);
  if (m.universe.length === 0 && !m.discover.enabled) {
    throw new z.ZodError([{ code: 'custom', path: ['universe'], message: 'Add candidate brands or turn on Qloo discovery.', input: m.universe }]);
  }
  if (total > 60) {
    throw new z.ZodError([{ code: 'custom', path: ['universe'], message: 'Universe plus discovery is capped at 60 brands.', input: m.universe }]);
  }
  return m;
}

/** Whether brands owned by another group are skipped for this mandate. */
export function skipsGroupOwned(m: Mandate): boolean {
  return m.excludeGroupOwned ?? m.dealType !== 'licensing';
}
