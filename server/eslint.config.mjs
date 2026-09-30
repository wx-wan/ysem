import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * ESLint flat config（ESLint v9）。
 *
 * 由旧的 `.eslintrc` 约定迁移而来：仓库此前没有任何 eslint 配置文件，
 * `npm run lint` 实际不可用（ESLint v9 只认 `eslint.config.js`）。
 *
 * 分层约束（controller/service/operation/repository）由 `npm run lint:layering` 单独把关，
 * 本配置只做通用静态检查。
 *
 * 取舍：规则集用 official recommended，但把**存量代码大面积违反**的规则降级为 warn，
 * 保证 `npm run lint` 现在即可跑通（exit 0）并逐步收敛。
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'prisma/migrations/**', 'prisma/migrations_legacy/**'] },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
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
