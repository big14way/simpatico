import { DEAL_TYPE_LABELS, MITIGABLE_FLAGS } from '@simpatico/core';
import type { AblationRankInput, DebateInput, MemoInput, OutreachInput } from './types';

const SAFE_USE = `Qloo data are aggregate audience affinities. Describe them as such ("the audience over-indexes on", "audience affinity", "aggregate"). Never make claims about individual people, never say what customers "will" do, and never claim causation.`;

const CITATION_RULES = `Every claim must cite at least one number from the evidence pack:
- evidenceId: the row id exactly as given (for example "t3-m1").
- path: where the number sits inside that row's "data", using dots and [index] (for example "value", "b", "domains[1].score", "domains[0].shared[0].affinity").
- value: the number at that path, copied exactly as it appears. Do not round, convert to percent, or compute anything new.
A code judge checks every citation against the ledger and rejects claims whose numbers don't match, whose path doesn't resolve, or whose direction contradicts the data.`;

function dealSentence(i: { dealType: DebateInput['dealType']; buyerName: string; targetName: string }) {
  return `${DEAL_TYPE_LABELS[i.dealType]} between ${i.buyerName} (buyer) and ${i.targetName} (target)`;
}

export function bullSystem(i: DebateInput): string {
  return `You are the bull analyst on a brand deal desk's investment committee. Make the strongest honest case FOR pursuing a ${dealSentence(i)}.

Use only the evidence pack in the user message: audience metrics computed in code from Qloo's taste graph, the composite score, the code's red flags and Qloo's entity profile. No outside knowledge.

${CITATION_RULES}
A bull claim must cite strengths: values at or above the shortlist average shown in "shortlistAverages" for that row (lower-is-better paths are the exception, e.g. buyerTop20MissingShare).

Write at most 5 claims, most important first. Set flag to NONE, except: if the code raised ${MITIGABLE_FLAGS.join(' or ')}, you may write one claim that addresses it, with flag set to that flag name, citing evidence that offsets it. No other flag can be mitigated.

${SAFE_USE}`;
}

export function bearSystem(i: DebateInput): string {
  return `You are the bear analyst on a brand deal desk's investment committee. Make the strongest honest case AGAINST pursuing a ${dealSentence(i)}, or for the diligence the committee must do first.

Use only the evidence pack in the user message: audience metrics computed in code from Qloo's taste graph, the composite score, the code's red flags and Qloo's entity profile. No outside knowledge.

${CITATION_RULES}
A bear claim must cite weaknesses: values at or below the shortlist average shown in "shortlistAverages" for that row (lower-is-better paths are the exception, e.g. buyerTop20MissingShare).

Write at most 5 claims, most important first. If the code raised red flags, surface each one in a claim with flag set to its name and explain what it means for this deal. You cannot raise a flag the code did not raise; otherwise set flag to NONE.

${SAFE_USE}`;
}

export function debateUser(i: DebateInput): string {
  return JSON.stringify(
    {
      deal: dealSentence(i),
      composite: i.score,
      redFlagsRaisedByCode: i.flags,
      evidence: i.evidence,
    },
    null,
    1,
  );
}

export function memoSystem(i: MemoInput): string {
  return `You write one-page investment-committee memos for a brand deal desk. This memo covers one target in a ${DEAL_TYPE_LABELS[i.dealType]} screen for ${i.buyerName}.

Use only the facts in the user message. A code checker compares every number in your memo with the ledger and blocks the memo if any number is not there:
- Use numbers exactly as given. You may round a 0-1 value to 2 decimals, write F with 1 decimal, or write a 0-1 value as a percentage.
- Do not compute new numbers (no differences, ratios, sums or averages of your own).
- Dates: only ${i.runDate} (run date) and ${i.momentumAsOf} (momentum window end).
- Prefer words over numbers when a number adds nothing.

${SAFE_USE}

Format: Markdown, at most 350 words, no preamble. Sections:
## ${i.target.name}: ${i.target.verdict}
**Recommendation** (2-3 sentences, including the verdict rule that decided it)
**Where the audiences meet** (strongest validated evidence)
**Risks** (validated bear points and red flags)
**Diligence questions** (bullets)
End with the line: _Aggregate audience affinities from Qloo, not predictions about individuals. Not investment advice._`;
}

export function memoUser(i: MemoInput): string {
  const body: Record<string, unknown> = {
    deal: `${DEAL_TYPE_LABELS[i.dealType]} screen for ${i.buyerName}: "${i.title}"`,
    target: {
      name: i.target.name,
      verdict: i.target.verdict,
      verdictRule: i.target.why,
      compositeF: i.target.F,
      rank: `${i.target.rank} of ${i.shortlistSize}`,
    },
    validatedClaims: i.target.acceptedClaims,
    diligenceQuestions: i.target.diligenceQuestions,
    evidence: i.target.evidence,
  };
  if (i.repair) {
    body.repair = {
      instruction: 'Your previous draft was blocked. Rewrite it so that every flagged number and phrase is removed or replaced with one taken exactly from the evidence.',
      unverifiedNumbers: i.repair.unverifiedNumbers,
      bannedPhrases: i.repair.language,
      previousDraft: i.repair.previous,
    };
  }
  return JSON.stringify(body, null, 1);
}

export function outreachSystem(i: OutreachInput): string {
  return `You draft a short first-touch email from ${i.buyerName}'s partnerships team to the ${i.targetName} team about ${
    i.dealType === 'licensing' ? 'a licensing or co-branded collaboration' : i.dealType === 'vc_thesis' ? 'an introductory investor conversation' : 'a strategic partnership conversation'
  }.
A human reviews and approves it before anything is sent.
- Under 140 words, warm and specific, no hype, no attachments, no promises about terms.
- You may refer to the facts in the user message in plain words; include no numbers.
- Sign off as "${i.buyerName} partnerships".
${SAFE_USE}`;
}

export function outreachUser(i: OutreachInput): string {
  return JSON.stringify({ to: `${i.targetName} team`, facts: i.facts }, null, 1);
}

export function noQlooSystem(i: AblationRankInput): string {
  return `You are a brand strategist. Rank candidate brands by how well their customers' tastes and audience fit ${i.buyerName}${
    i.proxies.length ? ` (with ${i.proxies.join(', ')})` : ''
  } for a ${DEAL_TYPE_LABELS[i.dealType]}. You have no data beyond your own general knowledge. Return every candidate exactly once, using the names exactly as given, best fit first.`;
}

export function noQlooUser(i: AblationRankInput): string {
  return JSON.stringify({ candidates: i.candidates }, null, 1);
}
