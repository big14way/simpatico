import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Simpatico: the audience-fit deal desk',
  description:
    'An agentic deal desk for brand acquisitions, licensing and co-branding. Screens targets against a buyer audience with Qloo’s taste graph, debates them with evidence-checked agents, and acts on the pipeline.',
};

const NAV = [
  { href: '/', label: 'Desk' },
  { href: '/mandate/new', label: 'New mandate' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/monitor', label: 'Monitor' },
  { href: '/ablation', label: 'Ablation' },
  { href: '/method', label: 'Method' },
  { href: '/settings', label: 'Settings' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="flex items-baseline gap-2 text-ink no-underline">
              <span className="text-lg font-bold tracking-tight">Simpatico</span>
              <span className="hidden text-xs text-muted sm:inline">audience-fit deal desk</span>
            </Link>
            <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Main">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="text-ink-2 no-underline hover:text-ink">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-10 pt-4 text-xs text-muted">
          Aggregate audience affinities from the Qloo Taste AI graph. Not predictions about individuals. Not investment advice. Illustrative
          public-data examples make no claim about any company&rsquo;s plans.
        </footer>
      </body>
    </html>
  );
}
