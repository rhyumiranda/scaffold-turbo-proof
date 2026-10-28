import tseslint from 'typescript-eslint';
export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'src/generated/**',
      'coverage/**',
      'test-results/**',
      'identity-test-results/**',
      'playwright-report/**',
      '.scaffold/**',
      'next-env.d.ts',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/features/**/components/**/*.tsx', 'src/features/**/hooks/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/*.server', '**/*.server.*', 'pg', '@prisma/client'],
              message: 'Use a Server Action or safe browser service; never import server transport here.',
            },
          ],
        },
      ],
    },
  },
);
