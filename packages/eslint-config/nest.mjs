import tseslint from 'typescript-eslint';
import { base } from './base.mjs';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.scaffold/**', '.turbo/**', 'src/generated/**'] },
  ...base,
);
