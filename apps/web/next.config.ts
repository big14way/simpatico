import path from 'node:path';
import type { NextConfig } from 'next';

// Local dev reads apps/web/.env (a gitignored symlink to the root .env); hosting uses real env vars.
const root = path.resolve(process.cwd(), '../..');

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: root,
  transpilePackages: ['@simpatico/qloo', '@simpatico/core', '@simpatico/store', '@simpatico/agents', '@simpatico/engine', '@simpatico/actions'],
  serverExternalPackages: ['pg', '@electric-sql/pglite', 'undici'],
  poweredByHeader: false,
  agentRules: false,
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
