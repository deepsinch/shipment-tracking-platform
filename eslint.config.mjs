import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // The CSP allows inline scripts (Next's RSC payload under partial prerendering), so raw
      // HTML must never be rendered: see src/lib/security-headers.ts.
      "react/no-danger": "error",
    },
  },
  // Turns off stylistic rules that would fight Prettier. Must come last.
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
