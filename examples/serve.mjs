#!/usr/bin/env node
/**
 * Serve examples with Vite and `@doeixd/affe/vite`, each at the site root on
 * its own port:
 *
 *   npm run examples              # every runnable example
 *   npm run examples -- todomvc   # just one
 *
 * The browser suite (browser-tests/examples.spec.ts) starts this with no
 * arguments and smoke-tests every example.
 *
 * Every `@doeixd/affe` import resolves to the SOURCE in src/ (derived from
 * the package's exports map). Mixing resolutions — tsconfig paths send the
 * main entry to src/ while compiled JSX imports the runtime from dist/ —
 * loads two copies of the reactive core whose owners and contexts never
 * meet. The plugin itself comes from dist/, so run `npm run build` once.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import affe from "../dist/vite.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));

const alias = Object.entries(pkg.exports)
  .filter(([key]) => key !== "./package.json")
  .map(([key, entry]) => {
    const target = (typeof entry === "string" ? entry : entry.import)
      .replace(/^\.\/dist\//, "src/")
      .replace(/\.js$/, ".ts");
    const specifier = key === "." ? pkg.name : `${pkg.name}/${key.slice(2)}`;
    return { find: new RegExp(`^${specifier.replace(/[/.]/g, "\\$&")}$`), replacement: path.join(repo, target) };
  });

/**
 * Examples with an index.html, in a stable order; ports are 4200 + index.
 * Examples with their own `build.mjs` (the resumability and permissive demos)
 * need a server build and have their own browser specs.
 */
export const examples = fs.readdirSync(here)
  .filter((name) => fs.existsSync(path.join(here, name, "index.html")))
  .filter((name) => !fs.existsSync(path.join(here, name, "build.mjs")))
  .sort();

export const portOf = (name) => 4200 + examples.indexOf(name);

const requested = process.argv.slice(2);
for (const name of requested) {
  if (!examples.includes(name)) {
    console.error(`Unknown example "${name}". Available: ${examples.join(", ")}`);
    process.exit(1);
  }
}

for (const name of requested.length > 0 ? requested : examples) {
  const server = await createServer({
    configFile: false,
    root: path.join(here, name),
    plugins: [affe()],
    resolve: { alias },
    logLevel: "warn",
    server: { host: "127.0.0.1", port: portOf(name), strictPort: true },
  });
  await server.listen();
  console.log(`${name.padEnd(28)} http://127.0.0.1:${portOf(name)}/`);
}
