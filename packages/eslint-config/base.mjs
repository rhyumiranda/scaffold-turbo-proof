import tseslint from 'typescript-eslint';

// Applications are leaves: an app never imports another app's package or source, by name or by relative path.
export const crossAppPatterns = [
  {
    group: [
      '@repo/api',
      '@repo/api/*',
      '@repo/web',
      '@repo/web/*',
      '**/apps/api/**',
      '**/apps/web/**',
      '**/api/src/**',
      '**/web/src/**',
    ],
    message:
      'Applications are leaves. Share code only through a declared packages/* workspace dependency such as @repo/api-client.',
  },
];

export const base = tseslint.config(...tseslint.configs.recommended, {
  rules: { 'no-restricted-imports': ['error', { patterns: crossAppPatterns }] },
});
