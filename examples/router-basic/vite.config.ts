import { defineConfig } from "vite";
import affe from "@doeixd/affe/vite";

// `npm run build:router-example` builds it and the browser suite
// (`browser-tests/router-basic.spec.ts`) serves it with `vite preview`.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [affe()],
  build: { outDir: "dist", emptyOutDir: true },
  preview: { host: "127.0.0.1", port: 4180, strictPort: true },
});
