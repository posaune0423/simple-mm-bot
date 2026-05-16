export default {
  lint: {
    env: {
      node: true,
    },
    ignorePatterns: [
      "artifacts/**",
      "coverage/**",
      "data/**",
      "dist/**",
      ".agents/memory/**",
      "node_modules/**",
      "tmp-*/**",
    ],
    options: {
      denyWarnings: true,
      reportUnusedDisableDirectives: "error",
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      eqeqeq: "error",
      "import/consistent-type-specifier-style": ["error", "prefer-top-level"],
      "import/first": "error",
      "import/no-cycle": "error",
      "import/no-duplicates": "error",
      "import/no-mutable-exports": "error",
      "no-duplicate-imports": "off",
      "no-var": "error",
      "prefer-const": ["error", { ignoreReadBeforeAssign: true }],
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          disallowTypeAnnotations: false,
          fixStyle: "separate-type-imports",
          prefer: "type-imports",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-for-in-array": "error",
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "typescript/no-deprecated": "error",
      "@typescript-eslint/no-require-imports": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/promise-function-async": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "zod", message: "Use valibot" }],
        },
      ],
    },
    overrides: [
      {
        files: ["src/**/*.ts", "scripts/**/*.ts", "*.config.ts"],
        rules: {
          "unicorn/filename-case": [
            "error",
            {
              cases: {
                camelCase: true,
                pascalCase: true,
              },
            },
          ],
        },
      },
      {
        files: ["src/utils/**/*.ts"],
        rules: {
          "unicorn/filename-case": ["error", { case: "camelCase" }],
        },
      },
      {
        files: ["src/domain/**/*.ts"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              paths: [
                { name: "zod", message: "Use valibot" },
                { name: "valibot", message: "Keep runtime validation outside the domain layer" },
                { name: "postgres", message: "Keep DB access outside the domain layer" },
                { name: "bulk-ts-sdk", message: "Keep SDK imports in adapters" },
                { name: "@nktkas/hyperliquid", message: "Keep SDK imports in adapters or lib" },
                { name: "viem", message: "Keep SDK imports outside the domain layer" },
              ],
              patterns: [
                "**/application/**",
                "**/adapters/**",
                "**/infrastructure/**",
                "**/lib/**",
                "**/config.ts",
                "**/env.ts",
                "**/utils/**",
                "node:*",
                "drizzle-orm",
                "drizzle-orm/*",
                "viem/*",
              ],
            },
          ],
        },
      },
      {
        files: ["src/application/**/*.ts"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              paths: [{ name: "zod", message: "Use valibot" }],
              patterns: [
                "**/adapters/**",
                "**/infrastructure/**",
                "**/infrastructure/db/**",
                "**/infrastructure/InMemoryPositionRepository.ts",
                "**/lib/**",
              ],
            },
          ],
        },
      },
      {
        files: ["src/application/di.ts"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              paths: [{ name: "zod", message: "Use valibot" }],
            },
          ],
        },
      },
      {
        files: ["src/adapters/**/*.ts"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              paths: [{ name: "zod", message: "Use valibot" }],
              patterns: ["**/application/**", "**/infrastructure/**"],
            },
          ],
        },
      },
      {
        files: ["src/infrastructure/**/*.ts"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              paths: [{ name: "zod", message: "Use valibot" }],
              patterns: ["**/application/**", "**/adapters/**"],
            },
          ],
        },
      },
      {
        files: ["src/lib/**/*.ts"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              paths: [{ name: "zod", message: "Use valibot" }],
              patterns: [
                "**/domain/**",
                "**/application/**",
                "**/adapters/**",
                "**/infrastructure/**",
              ],
            },
          ],
        },
      },
    ],
  },
  fmt: {
    options: {
      singleQuote: false,
      trailingComma: "all",
      printWidth: 120,
      tabWidth: 2,
      useTabs: false,
      semi: true,
    },
    ignorePatterns: [
      "artifacts/**",
      "coverage/**",
      "data/**",
      "dist/**",
      ".agents/memory/**",
      "node_modules/**",
      "tmp-*/**",
    ],
  },
};
