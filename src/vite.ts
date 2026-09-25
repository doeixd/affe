/**
 * `@doeixd/affe/vite` — compile Affe JSX in Vite.
 *
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from "vite";
 * import affe from "@doeixd/affe/vite";
 *
 * export default defineConfig({ plugins: [affe()] });
 * ```
 *
 * JSX compiles to fine-grained DOM operations with
 * `babel-plugin-jsx-dom-expressions`, pointed at `@doeixd/affe/runtime`.
 * Vite's own JSX transform cannot target that runtime, so this plugin runs
 * first (`enforce: "pre"`) and hands Vite plain JavaScript.
 *
 * Needs `@babel/core`, `@babel/preset-typescript` and
 * `babel-plugin-jsx-dom-expressions` installed next to Vite (optional peer
 * dependencies of `@doeixd/affe`; `create-affe` adds them). Babel loads
 * lazily inside the transform, so importing this module costs nothing.
 */
import type * as Babel from "@babel/core";
import type * as Vite from "vite";

export interface AffeViteOptions {
  /** Files to compile. Default: `.tsx` and `.jsx` outside `node_modules`. */
  readonly include?: RegExp | ((id: string) => boolean);
  /** Files to skip even when `include` matches. */
  readonly exclude?: RegExp | ((id: string) => boolean);
  /**
   * Emit hydration markers so a server-rendered page can be adopted by
   * `hydrateRoot`. Default `false`.
   */
  readonly hydratable?: boolean;
  /** Extra options passed to `babel-plugin-jsx-dom-expressions`. */
  readonly jsx?: Readonly<Record<string, unknown>>;
  /** Extra Babel plugins, run before the JSX transform. */
  readonly babelPlugins?: ReadonlyArray<Babel.PluginItem>;
}

const defaultInclude = /\.[jt]sx$/;
const defaultExclude = /[\\/]node_modules[\\/]/;

const matches = (pattern: RegExp | ((id: string) => boolean), id: string): boolean =>
  typeof pattern === "function" ? pattern(id) : pattern.test(id);

const missingBabel = (cause: unknown): Error =>
  new Error(
    "[affe/vite] Compiling JSX needs @babel/core, @babel/preset-typescript and "
      + "babel-plugin-jsx-dom-expressions. Install them as dev dependencies:\n"
      + "  npm install -D @babel/core @babel/preset-typescript babel-plugin-jsx-dom-expressions",
    { cause },
  );

/** The Vite plugin that compiles Affe JSX. */
export function affe(options: AffeViteOptions = {}): Vite.Plugin {
  const include = options.include ?? defaultInclude;
  const exclude = options.exclude ?? defaultExclude;
  let babel: typeof Babel | undefined;

  return {
    name: "affe",
    enforce: "pre",
    config() {
      // Vite's dependency scanner reads JSX itself (plugins do not run
      // there) and would otherwise assume React's runtime.
      return {
        optimizeDeps: {
          rolldownOptions: { transform: { jsx: { runtime: "automatic", importSource: "@doeixd/affe" } } },
        },
      } as Vite.UserConfig;
    },
    async transform(code, id) {
      const [filename] = id.split("?", 1);
      if (filename === undefined || filename.startsWith("\0")) return null;
      if (!matches(include, filename) || matches(exclude, filename)) return null;
      if (babel === undefined) {
        try {
          babel = (await import("@babel/core")) as typeof Babel;
        } catch (cause) {
          throw missingBabel(cause);
        }
      }
      const isTs = /\.tsx?$/.test(filename);
      const result = await babel.transformAsync(code, {
        filename,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        presets: isTs
          ? [["@babel/preset-typescript", { allExtensions: true, isTSX: true, onlyRemoveTypeImports: true }]]
          : [],
        plugins: [
          ...(options.babelPlugins ?? []),
          [
            "babel-plugin-jsx-dom-expressions",
            {
              moduleName: "@doeixd/affe/runtime",
              generate: "dom",
              hydratable: options.hydratable ?? false,
              delegateEvents: true,
              contextToCustomElements: true,
              ...options.jsx,
            },
          ],
        ],
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (/Cannot find (module|package)/.test(message)) throw missingBabel(error);
        throw error;
      });
      if (result?.code == null) return null;
      return { code: result.code, map: result.map ?? null };
    },
  };
}

export default affe;
