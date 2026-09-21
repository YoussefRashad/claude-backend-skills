import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import prettier from 'eslint-config-prettier';

import sonarjs from 'eslint-plugin-sonarjs';
import security from 'eslint-plugin-security';
import unusedImports from 'eslint-plugin-unused-imports';

import importPlugin from 'eslint-plugin-import';
import simpleImportSort from 'eslint-plugin-simple-import-sort';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'eslint.config.*'],
  },

  // Base JS rules
  js.configs.recommended,

  // TS basic rules
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  // Tooling JS/MJS/CJS (scripts/, root config files) are NOT part of the
  // type-aware `project` in tsconfig.eslint.json, so the type-aware rules cannot
  // run on them — eslint throws if they try. Turn type-checking OFF for these
  // files; src/test below still get the full type-aware layer.
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: { ...globals.node },
    },
  },

  // TYPE-AWARE LAYER — only src/test get the type-aware project parser.
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],

    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
      },
    },

    plugins: {
      sonarjs,
      security,
      'unused-imports': unusedImports,
      import: importPlugin,
      'simple-import-sort': simpleImportSort,
    },

    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.eslint.json',
          alwaysTryTypes: true,
          cache: true,
        },
      },
    },

    rules: {
      // General
      // `error`, not `warn`: 02 §2.5 makes this a MUST NOT, because console output
      // goes to stdout — outside the audited log store and outside its retention, so
      // a console.log of a request body writes Class B/C data somewhere it must never
      // appear. A rule at `warn` does not enforce a MUST NOT. Specs override it below.
      'no-console': 'error',
      'no-debugger': 'error',

      // TypeScript
      '@typescript-eslint/no-explicit-any': 'warn',

      // ⚠️ consistent-type-imports is OFF, deliberately. Do not turn it on here.
      //
      // It is incompatible with `emitDecoratorMetadata`, which NestJS requires. The
      // rule sees a constructor parameter type as "type-only usage" and --fix rewrites
      //
      //   import { Reflector } from '@nestjs/core';
      // to
      //   import type { Reflector } from '@nestjs/core';
      //
      // TypeScript then erases the import, `design:paramtypes` emits `Object` instead
      // of `Reflector`, and the container fails at runtime with "Nest can't resolve
      // dependencies of X (?)". Nothing in lint, tsc, or a unit test catches it — and
      // because lint-staged runs `eslint --fix` on every commit, the rule does not
      // merely tolerate the bug, it introduces it into code that was correct.
      //
      // The upside it offered (cheaper builds, fewer import cycles) is already covered
      // by `import/no-cycle` below. Writing `import type` by hand is still fine and
      // still encouraged for genuinely type-only imports.
      '@typescript-eslint/consistent-type-imports': 'off',

      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],

      'unused-imports/no-unused-vars': [
        'error',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],

      // Type-safety flood: `no-unsafe-*` fires everywhere `any` flows through
      // untyped code (untyped axios responses, JSON.parse, noImplicitAny off).
      // Kept as `warn` so a not-yet-fully-typed project still builds. Ratchet a
      // module back to `error` with a folder-scoped override once it is typed
      // (see the "ratchet" note in SKILL.md).
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',

      'import/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: [
            '**/*.spec.ts',
            '**/*.e2e-spec.ts',
            'test/**',
            'src/test/**',
            '**/test/**',
            '**/*.setup.ts',
            '**/*.config.ts',
            '**/*.seed.ts',
          ],
        },
      ],
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',

      // ── Rules that move a 04 Part B check into Part A ────────────────────────
      // 04 says: "If a rule in Part B can be moved here, move it. That is the
      // direction of travel." These two are the ones worth a reviewer's attention
      // and cheap to detect mechanically. Both back a MUST, so both are `error`.
      // If a legacy repo has many, scope them down per-folder (see the ratchet note
      // in SKILL.md) rather than deleting them.
      'no-restricted-syntax': [
        'error',
        {
          // 01 §5 / 02 §6 — an `any`-typed @Body()/@Query()/@Param() bypasses
          // class-validator entirely: no DTO, no decorators, no validation. The
          // endpoint looks validated and is not.
          selector:
            'Identifier[decorators.0.expression.callee.name=/^(Body|Query|Param|Headers)$/] TSAnyKeyword',
          message:
            '01 §5: @Body()/@Query()/@Param() MUST NOT be typed `any` — it bypasses validation entirely. Use a DTO with validation decorators.',
        },
        {
          // Same rule, other half: an inline object literal type has no decorators
          // to validate against, so it bypasses validation just as completely.
          selector:
            'Identifier[decorators.0.expression.callee.name=/^(Body|Query|Param|Headers)$/] TSTypeLiteral',
          message:
            '01 §5: @Body()/@Query()/@Param() MUST NOT use an inline object literal type — it bypasses validation. Declare a DTO class.',
        },
        {
          // 01 §7 / 02 §6 — a template literal WITH interpolation in a query-builder
          // call is string interpolation into SQL. A template literal with no
          // expressions is just a quoted string and is not matched.
          selector:
            'CallExpression[callee.property.name=/^(where|andWhere|orWhere|having|andHaving|orHaving|orderBy|addOrderBy|groupBy|addGroupBy|select|addSelect|query|on|leftJoin|innerJoin|leftJoinAndSelect|innerJoinAndSelect)$/] > TemplateLiteral[expressions.length>0]',
          message:
            '01 §7: MUST NOT interpolate into SQL. Pass values as bound parameters (`:name` + a params object); resolve dynamic identifiers through the allowlist in sortable.ts.',
        },
        {
          // The same interpolation, spelled with `+` instead of a template literal.
          selector:
            "CallExpression[callee.property.name=/^(where|andWhere|orWhere|having|andHaving|orHaving|orderBy|addOrderBy|groupBy|addGroupBy|query)$/] > BinaryExpression[operator='+']",
          message:
            '01 §7: MUST NOT build SQL by string concatenation. Pass values as bound parameters.',
        },
      ],

      // Imports
      'sort-imports': 'off',

      // Security — detect-object-injection is mostly false positives on internal
      // bracket-access (own-key iteration, enum-keyed maps). Kept `warn`; fix
      // genuinely attacker-controlled reads inline.
      'security/detect-object-injection': 'warn',

      // Security — high-signal rules from eslint-plugin-security. Kept `warn`
      // (ratchet: surface without breaking existing code). These catch injection,
      // ReDoS, weak-random and unsafe-fs classes at lint time instead of in an
      // audit months later. `detect-object-injection` above is deliberately the
      // ONLY one left noisier; the rest below are low-false-positive.
      'security/detect-child-process': 'warn',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-non-literal-require': 'warn',
      'security/detect-eval-with-expression': 'warn',
      'security/detect-unsafe-regex': 'warn',
      'security/detect-pseudoRandomBytes': 'warn',
      'security/detect-buffer-noassert': 'warn',
      'security/detect-new-buffer': 'warn',
      'security/detect-disable-mustache-escape': 'warn',
      'security/detect-no-csrf-before-method-override': 'warn',
      'security/detect-bidi-characters': 'warn',
      // detect-possible-timing-attacks intentionally OFF — very high false-positive
      // rate on any variable named `token`/`password` in a comparison.

      // SonarJS
      'sonarjs/cognitive-complexity': ['warn', 15],

      // NOTE: formatting is owned by Prettier as a standalone tool (run via
      // lint-staged / `npm run format`), NOT by eslint-plugin-prettier. We keep
      // eslint-config-prettier (spread at the end) to turn OFF formatting rules
      // that would conflict with Prettier.

      // Sorting
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            // Node.js builtins
            ['^node:'],
            // External packages
            ['^@?\\w'],
            // Internal aliases
            ['^@/'],
            // Parent imports
            ['^\\.\\.(?!/?$)', '^\\.\\./?$'],
            // Sibling imports
            ['^\\./(?=.*/)(?!/?$)', '^\\.(?!/?$)', '^\\./?$'],
          ],
        },
      ],
      'simple-import-sort/exports': 'error',
      'import/extensions': 'off',
      'import/first': 'error',

      // Architecture validation
      'import/no-cycle': 'error',
      'import/no-unresolved': 'error',
      'import/no-duplicates': 'error',
      'import/newline-after-import': 'error',

      'import/no-default-export': 'off',
      'import/prefer-default-export': 'off',
    },
  },

  // TEST LAYER — specs ARE linted (import sorting, unused imports), but the noisy
  // type-aware rules are relaxed: test code legitimately uses `any`, unbound mocks
  // and fire-and-forget calls. Must come after the main block so it wins for specs.
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],

    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      'import/no-extraneous-dependencies': 'off',
      // A spec legitimately logs while diagnosing, and a spec is not a request path —
      // it cannot write Class B/C data to the audited store's stdout. 02 §2.5 is about
      // application code.
      'no-console': 'off',
      // Specs construct fixtures and stubs that deliberately mimic bad shapes.
      'no-restricted-syntax': 'off',
      // Conditional assertions (`cond ? expect(a) : expect(b)`) are a valid pattern.
      '@typescript-eslint/no-unused-expressions': [
        'error',
        { allowShortCircuit: true, allowTernary: true },
      ],
      'unused-imports/no-unused-vars': 'warn',
    },
  },

  prettier,
);
