// ESLint flat config (ESLint 9+ / Vite-style).
// Type-aware TypeScript + React 19 rules, with Prettier owning formatting.
//
// Note on the TypeScript pin: typescript-eslint@8.70.x only supports
// `>=4.8.4 <6.1.0`. The project therefore uses typescript@6.0.3.

import js from "@eslint/js";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import plugin from "@typescript-eslint/eslint-plugin";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettierRecommended from "eslint-config-prettier";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
  // Files ESLint should never lint
  globalIgnores([
    "dist/**",
    "public/**",
    "node_modules/**",
    "eslint.config.mjs",
  ]),

  // Stand-alone JS / build & config scripts (Node context, no TS types)
  {
    name: "js/scripts",
    files: ["**/*.{js,mjs,cjs}"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
  },

  // TypeScript + React — type-aware
  {
    name: "ts/react",
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
    ],
    plugins: {
      "@typescript-eslint": plugin,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser },
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // React Hooks rules
      ...reactHooks.configs.recommended.rules,

      // React Refresh rules
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],

      // Match tsconfig's noUnusedLocals/noUnusedParameters but allow `_`-prefixed.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // Prettier LAST so it wins any rule conflict with @typescript-eslint stylistic.
  prettierRecommended,
);
