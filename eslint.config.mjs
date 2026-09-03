import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored CPython/WASM build copied in by the prebuild step. Third-party
    // and unreadable by design; linting it buried our own 3 findings under
    // 5,400 warnings.
    "public/pyodide/**",
  ]),
]);

export default eslintConfig;
