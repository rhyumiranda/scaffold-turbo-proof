import path from 'node:path';
import type { NextConfig } from 'next';
import { deploymentSettings } from './src/lib/deployment';

const config: NextConfig = {
  ...deploymentSettings(),
  poweredByHeader: false,
  output: 'standalone',
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};
export default config;
