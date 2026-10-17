import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // AGENTS.md rule 1: provider SDKs only inside the LLM adapters.
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
    ignores: ["src/lib/llm/providers/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["openai", "openai/*", "@anthropic-ai/*", "@google/genai"],
              message: "Call models only through src/lib/llm (generateStructured).",
            },
          ],
        },
      ],
    },
  },
  // AGENTS.md rule 6 and CLAUDE.md "a block means stop": outbound requests go
  // through botFetch, which sends our user agent and stops on any refusal.
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
    ignores: ["src/lib/http/**", "**/*.test.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "Use botFetch from src/lib/http/fetch (honest UA, stops on blocks)." },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated, gitignored copies: MapLibre's worker, and local map files for development.
    "public/maplibre/**",
    "public/map-dev/**",
    "map-build/**",
  ]),
]);

export default eslintConfig;
