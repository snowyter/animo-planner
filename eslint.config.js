import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    // Kept in step with .gitignore by src/repoGuardrails.test.ts: every
    // directory .gitignore ignores must be ignored here too, or eslint
    // lints build output / agent-tool files and its failure — chained with
    // && in `npm run verify` — silently swallows the Rust half (finding 0).
    ignores: [
      "dist/**",
      "dist-ssr/**",
      "src-tauri/**",
      "node_modules/**",
      ".scratch/**",
      "target/**",
      ".codebuddy/**",
      ".vscode/**",
      "release-staging/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
);
