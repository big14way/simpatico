import type { MandateInput } from './mandate';

export interface Scenario {
  slug: string;
  label: string;
  blurb: string;
  mandate: MandateInput;
  /** names the demo expects a human to confirm or drop at the confirm-chip step */
  expectChips?: string[];
}

const names = (xs: string[]) => xs.map((name) => ({ name }));

/**
 * Showcases are pinned to one momentum window so a re-run sees the same evidence: its Qloo
 * trending calls replay from the pinned cache and its Claude answers from the stored ones.
 * (Qloo's trending series has been flat since mid-October 2025, so the window costs nothing.)
 */
export const SHOWCASE_AS_OF = '2026-10-24';

/**
 * Illustrative public-data examples. They make no claim about any company's actual plans.
 */
export const SCENARIOS: Scenario[] = [
  {
    slug: 'bfy-bolt-on',
    label: 'M&A bolt-on: better-for-you',
    blurb: 'A PepsiCo-style buyer screens 30 better-for-you food and beverage brands for an audience-fit bolt-on.',
    expectChips: ['PepsiCo'],
    mandate: {
      title: 'Better-for-you bolt-on screen',
      dealType: 'ma_bolt_on',
      buyer: { name: 'PepsiCo' },
      proxies: names(['Doritos', 'Gatorade', 'Quaker']),
      universe: [
        // the back-test: brands PepsiCo announced deals for (Siete, Oct 2024; poppi, Mar 2025) are pinned
        { name: 'Poppi', pin: true },
        { name: 'Siete', pin: true },
        ...names([
        'Olipop', 'Athletic Brewing', 'Liquid Death', 'Chobani', 'Spindrift', 'Bai', 'Hu Kitchen',
        'Simple Mills', 'Magic Spoon', 'Recess', 'Partake', 'Mid-Day Squares', 'Vital Farms', 'Oatly', 'Kind Snacks',
        'RXBAR', 'Health-Ade', "GT's Kombucha", 'Celsius', 'Liquid I.V.', 'Zevia', 'Banza', "Lily's",
        "Dave's Killer Bread", 'Perfect Bar', 'Primal Kitchen', 'Califia Farms', 'LesserEvil',
        ]),
      ],
      // Keep brands the buyer already owns visible: the back-test asks where they land.
      excludeOwned: false,
      shortlistSize: 8,
      momentumAsOf: SHOWCASE_AS_OF,
    },
  },
  {
    slug: 'dodgers-collab',
    label: 'Licensing / co-brand: sports x streetwear',
    blurb: 'The Los Angeles Dodgers pick an apparel and streetwear collaboration partner from 26 labels (illustrative only).',
    expectChips: ['Aime Leon Dore'],
    mandate: {
      title: 'Dodgers streetwear collaboration screen',
      dealType: 'licensing',
      buyer: { name: 'Los Angeles Dodgers' },
      proxies: [],
      universe: names([
        'Kith', 'Stussy', 'Supreme', 'Palace Skateboards', 'Noah', 'New Era', 'Carhartt', 'Online Ceramics', 'Rhude',
        'Fear of God', 'Golf Wang', 'Awake NY', 'Stone Island', 'Patagonia', 'The North Face', 'Vans', 'Converse',
        'Champion', 'Mitchell & Ness', '47 Brand', 'Off-White', 'A Bathing Ape', 'Aime Leon Dore', 'Lululemon',
        'Nike', 'Adidas',
      ]),
      excludeOwned: true,
      shortlistSize: 8,
      momentumAsOf: SHOWCASE_AS_OF,
    },
  },
  {
    slug: 'run-club-thesis',
    label: 'VC thesis: run-club culture',
    blurb: 'A consumer fund screens emerging brands against a "run-club culture" audience seeded by HOKA, On, Tracksmith and Athletic Brewing.',
    expectChips: ['Satisfy Running'],
    mandate: {
      title: 'Run-club culture thesis screen',
      dealType: 'vc_thesis',
      buyer: { name: 'Hoka' },
      proxies: names(['On Running', 'Tracksmith', 'Athletic Brewing']),
      universe: names([
        'District Vision', 'Janji', 'Vuori', 'Alo Yoga', 'Outdoor Voices', 'Set Active', 'LMNT', 'Maurten',
        'Athletic Greens', 'Whoop', 'Oura', 'Strava', 'Therabody', 'Hyperice', 'Allbirds', 'Brooks Running', 'Saucony',
        'Altra', "Arc'teryx", 'Cotopaxi', 'Nuun', 'Liquid I.V.', 'Olipop', 'Satisfy Running',
      ]),
      excludeOwned: true,
      shortlistSize: 8,
      momentumAsOf: SHOWCASE_AS_OF,
    },
  },
];

export function scenario(slug: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.slug === slug);
}
