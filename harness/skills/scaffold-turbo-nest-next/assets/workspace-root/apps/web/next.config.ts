import path from 'node:path';
import type { NextConfig } from 'next';
import { deploymentSettings, limitClientChunkSize } from './src/lib/deployment';

const config: NextConfig = {
  ...deploymentSettings(),
  poweredByHeader: false,
  // The app serves no optimized images; the optimizer endpoint would otherwise answer odd URLs with a 500.
  images: { unoptimized: true },
  output: 'standalone',
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  webpack(webpackConfig, { isServer }) {
    return limitClientChunkSize(webpackConfig, isServer);
  },
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
