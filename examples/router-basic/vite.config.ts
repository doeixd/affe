import { defineConfig } from "vite";

// Compiles the example's JSX with the same Babel plugin configuration users
// get from the docs; `npm run build:router-example` builds it and the browser
// suite (`browser-tests/router-basic.spec.ts`) serves it with `vite preview`.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    {
      name: "affe-jsx",
      enforce: "pre",
      async transform(code, id) {
        const [filename] = id.split("?");
        if (filename === undefined || !filename.endsWith(".tsx")) return null;
        const babel = await import("@babel/core");
        const result = await babel.transformAsync(code, {
          filename,
          babelrc: false,
          configFile: false,
          sourceMaps: true,
          presets: [["@babel/preset-typescript", { allExtensions: true, isTSX: true }]],
          plugins: [
            [
              "babel-plugin-jsx-dom-expressions",
              { moduleName: "@doeixd/affe/runtime", generate: "dom", hydratable: false, delegateEvents: true },
            ],
          ],
        });
        return result?.code == null ? null : { code: result.code, map: result.map ?? null };
      },
    },
  ],
  build: { outDir: "dist", emptyOutDir: true },
  preview: { host: "127.0.0.1", port: 4180, strictPort: true },
});
