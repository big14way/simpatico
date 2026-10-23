import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="text-sm text-ink-2">That screen or target does not exist on this deployment.</p>
      <Link href="/">Back to the desk</Link>
    </div>
  );
}
