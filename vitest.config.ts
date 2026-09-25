import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  // Vite 8 transforms TypeScript with Oxc, which does not read
  // `jsxImportSource` from tsconfig; without this, JSX in examples compiles
  // against react/jsx-dev-runtime.
  oxc: { jsx: { runtime: "automatic", importSource: "@doeixd/affe" } },
  resolve: {
    // Workspace adapter packages import the PUBLIC core subpaths. Under test
    // those resolve to `src/` (one module identity with the suite — the
    // `Symbol.for` registry would tolerate dist, but a stale `dist/` must
    // never decide a test), and `@doeixd/affe-ui-agent` resolves to its source.
    alias: {
      "@doeixd/affe/Agent": here("./src/Agent.ts"),
      "@doeixd/affe-ui-agent": here("./packages/agent/src/index.ts"),
      "@doeixd/affe-css": here("./packages/css/src/index.ts"),
      "@doeixd/affe/Style": here("./src/Style.ts"),
      "@doeixd/affe/Theme": here("./src/Theme.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    // Run tests serially so global reactive state doesn't bleed between tests.
    pool: "forks",
    singleFork: true,
  },
});
