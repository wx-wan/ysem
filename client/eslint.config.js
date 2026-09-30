import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * ESLint flat config（ESLint v9）。
 *
 * 由旧的 `.eslintrc` 约定迁移而来：仓库此前没有任何 eslint 配置文件，
 * `npm run lint` 实际不可用（ESLint v9 只认 `eslint.config.js`）。
 *
 * 取舍：规则集用 official recommended，但把**存量代码大面积违反**的规则降级为 warn，
 * 保证 `npm run lint` 现在即可跑通（exit 0）并逐步收敛，而不是一次性刷出成百上千错误。
 * 新增代码请勿新增这些告警（`npm run lint -- --max-warnings 0` 可用于严格门禁）。
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'public/**', 'vite.config.ts'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // 仅导出组件（允许导出常量）：HMR 友好性提示
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // ---- 存量降级（技术债登记，逐步清零）----
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-empty-object-type': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
);
