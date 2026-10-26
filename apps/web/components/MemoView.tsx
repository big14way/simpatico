'use client';

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Checks {
  ok?: boolean;
  unverifiedNumbers?: string[];
  language?: { phrase: string; match: string; suggestion: string }[];
  numbersChecked?: number;
  repaired?: boolean;
  source?: 'llm' | 'template';
  cached?: boolean;
}

type HastNode = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** rehype plugin: wrap every flagged number / phrase in <mark>. */
function markTokens(tokens: string[]) {
  return () => (tree: HastNode) => {
    const list = [...new Set(tokens.filter(Boolean))].sort((a, b) => b.length - a.length);
    if (list.length === 0) return;
    const re = new RegExp(`(?<![\\w.])(${list.map(esc).join('|')})(?!\\w|\\.\\d)`, 'gi');
    const walk = (node: HastNode) => {
      if (!node.children) return;
      const out: HastNode[] = [];
      for (const child of node.children) {
        if (child.type === 'text' && typeof child.value === 'string') {
          let last = 0;
          for (const m of child.value.matchAll(re)) {
            if (m.index! > last) out.push({ type: 'text', value: child.value.slice(last, m.index) });
            out.push({ type: 'element', tagName: 'mark', properties: { title: 'Not found in the evidence ledger' }, children: [{ type: 'text', value: m[0] }] });
            last = m.index! + m[0].length;
          }
          if (last < child.value.length) out.push({ type: 'text', value: child.value.slice(last) });
        } else {
          walk(child);
          out.push(child);
        }
      }
      node.children = out;
    };
    walk(tree);
  };
}

export function MemoView({ markdown, checks, model, filename }: { markdown: string; checks: Checks; model: string | null; filename: string }) {
  const unverified = checks.unverifiedNumbers ?? [];
  const language = checks.language ?? [];
  const ok = checks.ok !== false && unverified.length === 0 && language.length === 0;
  const download = () => {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="space-y-3">
      <div className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${ok ? 'border-line' : 'border-critical'}`}>
        <span className={ok ? 'text-good-ink' : 'text-critical'}>
          {ok
            ? `Number check passed: ${checks.numbersChecked ?? 0} number(s), all in the evidence ledger.`
            : `Blocked from export: ${unverified.length} number(s) not in the ledger${language.length ? `, ${language.length} wording issue(s)` : ''} (highlighted).`}
        </span>
        <span className="flex items-center gap-2 text-xs text-muted">
          {checks.source === 'llm'
            ? `Written by ${model ?? 'the model'}${checks.repaired ? ' (after one repair pass)' : ''}${checks.cached ? '; stored answer for the same prompt and evidence' : ''}`
            : 'Written from the ledger template'}
          <button type="button" className="btn btn-ghost !px-2 !py-0.5 !text-xs" disabled={!ok} onClick={download} title={ok ? 'Download Markdown' : 'Fix the flagged numbers first'}>
            Export .md
          </button>
        </span>
      </div>
      {language.length > 0 && (
        <ul className="text-xs text-ink-2">
          {language.map((l, i) => (
            <li key={i}>
              &ldquo;{l.match}&rdquo; claims more than aggregate data supports; use &ldquo;{l.suggestion}&rdquo;.
            </li>
          ))}
        </ul>
      )}
      <article className="prose-memo text-sm text-ink">
        <Markdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[markTokens([...unverified, ...language.map((l) => l.match)])]}
          components={{ table: ({ node: _node, ...props }) => <div className="overflow-x-auto"><table {...props} /></div> }}
        >
          {markdown}
        </Markdown>
      </article>
    </div>
  );
}
