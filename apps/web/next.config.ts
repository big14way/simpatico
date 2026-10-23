import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// The monorepo keeps one .env at the root; load it for local dev (hosting uses real env vars).
const root = path.resolve(process.cwd(), '../..');
loadEnvConfig(root);
process.env.PGLITE_DIR ??= path.join(root, '.data', 'pglite');

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: root,
  transpilePackages: ['@simpatico/qloo', '@simpatico/core', '@simpatico/store', '@simpatico/agents', '@simpatico/engine', '@simpatico/actions'],
  serverExternalPackages: ['pg', '@electric-sql/pglite', 'undici'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

export default nextConfig;
