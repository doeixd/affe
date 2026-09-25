/**
 * The examples `serve.mjs` serves and `browser-tests/examples.spec.ts`
 * smoke-tests: those with an index.html, in a stable order, each on port
 * 4200 + its index. Examples with their own `build.mjs` (the resumability
 * and permissive demos) need a server build and have their own specs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const examplesDir = path.dirname(fileURLToPath(import.meta.url));

export const examples = fs.readdirSync(examplesDir)
  .filter((name) => fs.existsSync(path.join(examplesDir, name, "index.html")))
  .filter((name) => !fs.existsSync(path.join(examplesDir, name, "build.mjs")))
  .sort();

export const portOf = (name) => 4200 + examples.indexOf(name);
