import tseslint from 'typescript-eslint';
import { base, crossAppPatterns } from './base.mjs';

// Database drivers and Nest code never belong in the web app, in any file.
const serverOnlyPackages = {
  group: ['pg', 'pg/*', '@prisma/client', 'typeorm', 'mysql2', '@nestjs/*'],
  message: 'Database and Nest code belong in apps/api; call the API through a server service.',
};

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      '.scaffold/**',
      '.turbo/**',
      'next-env.d.ts',
    ],
  },
  ...base,
  {
    files: ['**/*.{ts,tsx,mjs}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [...crossAppPatterns, serverOnlyPackages] }] },
  },
  {
    // Later config objects replace the rule options, so repeat the shared patterns here.
    files: ['src/features/**/components/**/*.tsx', 'src/features/**/hooks/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...crossAppPatterns,
            serverOnlyPackages,
            {
              group: ['**/*.server', '**/*.server.*'],
              allowTypeImports: true,
              message: 'Use a Server Action or safe browser service; never import server transport here.',
            },
          ],
        },
      ],
    },
  },
);
