import { describe, expect, it } from 'vitest';
import type { EntityHit } from '@simpatico/qloo';
import { chooseHit, normalizeName, ownershipOf, sameParent } from '../src/resolve';

const hit = (name: string, popularity = 0.5, id = name): EntityHit => ({
  id, name, types: ['urn:entity:brand'], popularity, disambiguation: null, description: null, imageUrl: null, categoryTags: [],
});

describe('normalizeName', () => {
  it('folds case, accents, punctuation and corporate suffixes', () => {
    expect(normalizeName('Stüssy')).toBe('stussy');
    expect(normalizeName('Athletic Brewing Co')).toBe('athletic brewing');
    expect(normalizeName('The North Face')).toBe('north face');
    expect(normalizeName('Mitchell & Ness')).toBe('mitchell and ness');
    expect(normalizeName('Off-White')).toBe('off white');
    expect(normalizeName("GT's Kombucha")).toBe('gts kombucha');
    expect(normalizeName('47 Brand')).toBe('47');
  });
});

describe('chooseHit (no relevance score from /search, so names decide)', () => {
  it('takes an exact name match among several hits', () => {
    const r = chooseHit('Liquid Death', [hit('Liquid Death'), hit('Death Stranding'), hit('Liquid I.V.')]);
    expect(r).toMatchObject({ decision: 'resolved', reason: 'exact' });
  });
  it('treats spacing differences as exact ("RXBAR" / "RX Bar")', () => {
    expect(chooseHit('RXBAR', [hit('RX Bar')])).toMatchObject({ decision: 'resolved', reason: 'exact' });
  });
  it('takes the only name-compatible hit wherever it sits', () => {
    expect(chooseHit('Health-Ade', [hit("Women's Health"), hit('Health-ade Kombucha'), hit('World Health Organization')])).toMatchObject({
      decision: 'resolved',
      hit: { name: 'Health-ade Kombucha' },
    });
    expect(chooseHit('On Running', [hit('On'), hit('Cotton On'), hit('Brooks Running')])).toMatchObject({ decision: 'resolved', hit: { name: 'On' } });
  });
  it('breaks ties by a clear popularity margin only', () => {
    expect(chooseHit('Quaker', [hit('Quaker Oats Company', 0.97), hit('Quaker Steak & Lube', 0.23)])).toMatchObject({ decision: 'resolved', reason: 'popularity' });
    expect(chooseHit('Salomon', [hit('Salomon Group', 0.97), hit('YVES SALOMON', 0.81)]).decision).toBe('ambiguous');
  });
  it('asks a human when nothing matches the name', () => {
    expect(chooseHit('PepsiCo', [hit('Pepsi')]).decision).toBe('ambiguous');
    expect(chooseHit('Aime Leon Dore', [hit('Breitling'), hit('DORÉ'), hit('Tigres UANL')]).decision).toBe('ambiguous');
    expect(chooseHit('Madhappy', []).decision).toBe('none');
  });
});

describe('ownership', () => {
  it('compares parents loosely and classifies targets', () => {
    expect(sameParent('PepsiCo, Inc.', 'PepsiCo')).toBe(true);
    expect(ownershipOf('Poppi', 'PepsiCo, Inc.', ['PepsiCo, Inc.'])).toBe('owned_by_buyer');
    expect(ownershipOf('Chobani', 'Chobani, LLC', ['PepsiCo, Inc.'])).toBe('independent');
    expect(ownershipOf("GT's Kombucha", "GT's Living Foods", [])).toBe('independent');
    expect(ownershipOf('Kind Snacks', 'Mars, Incorporated', ['PepsiCo, Inc.'])).toBe('part_of_other');
    expect(ownershipOf('Olipop', null, [])).toBe('unknown');
  });
});

describe('shorter hits must keep the lead word', () => {
  it('accepts "Carhartt WIP" -> Carhartt and "Fear of God Essentials" -> Fear Of God, rejects unrelated suffix matches', () => {
    expect(chooseHit('Carhartt WIP', [hit('Carhartt', 0.97), hit('Reddi-wip', 0.44), hit('Wipro Limited', 0.95)])).toMatchObject({ decision: 'resolved', hit: { name: 'Carhartt' } });
    expect(chooseHit('Fear of God Essentials', [hit('Fear Of God'), hit('God of War Ragnarok')])).toMatchObject({ decision: 'resolved', hit: { name: 'Fear Of God' } });
    expect(chooseHit('Satisfy Running', [hit('Brooks Running', 0.97), hit('On', 0.91), hit('Altra Running', 0.87)]).decision).toBe('ambiguous');
    // a one-word brand that merely shares the lead word is a different brand
    expect(chooseHit('Aime Leon Dore', [hit('Aime', 0.45), hit('DORÉ', 0.9)]).decision).toBe('ambiguous');
  });
});
