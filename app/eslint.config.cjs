const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");
const reactPlugin = require("eslint-plugin-react");

module.exports = [
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    ignores: ["dist/**", "node_modules/**", "*.config.js", "*.config.cjs"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        browser: "readonly",
        es2020: "readonly",
        node: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      react: reactPlugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
    settings: {
      react: { version: "detect" },
    },
  },
  {
    // These two guardrails cover the regressions that a sweep fixes once and a
    // hundred small edits quietly undo (DESIGN.md §3, §5).
    //
    // 1. The type scale has a floor of 11px (`text-2xs`). An arbitrary
    //    `text-[13px]` is not a decision, it is the absence of one — and a
    //    `clamp()` display size is the only fluid value allowed to be a step of
    //    its own, so the selector only fires on a numeric size.
    // 2. Focus is one pattern, owned by `atoms/Button` and `atoms/IconButton`:
    //    a 2px `--aw-primary` outline at `--aw-focus-ring-offset`, on
    //    `focus-visible` only. `focus:ring-*` is the legacy spelling of it.
    files: ["src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'JSXAttribute[name.name="className"] Literal[value=/text-\\[[0-9.]/]',
          message:
            "Arbitrary font size. Use the documented scale — text-2xs (11px, the floor), text-xs (12px), text-sm (14px), text-base (16px). See DESIGN.md §3.",
        },
        {
          selector:
            'JSXAttribute[name.name="className"] TemplateElement[value.raw=/text-\\[[0-9.]/]',
          message:
            "Arbitrary font size. Use the documented scale — text-2xs (11px, the floor), text-xs (12px), text-sm (14px), text-base (16px). See DESIGN.md §3.",
        },
        {
          selector:
            'JSXAttribute[name.name="className"] Literal[value=/focus:ring/]',
          message:
            "Legacy focus ring. Use the canonical focus-visible pattern: focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:outline-offset-(--aw-focus-ring-offset). See DESIGN.md §5.",
        },
        {
          selector:
            'JSXAttribute[name.name="className"] TemplateElement[value.raw=/focus:ring/]',
          message:
            "Legacy focus ring. Use the canonical focus-visible pattern: focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:outline-offset-(--aw-focus-ring-offset). See DESIGN.md §5.",
        },
      ],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
    rules: {
      "no-console": "off",
    },
  },
];
