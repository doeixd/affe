/**
 * Regenerates deprecated/effect-atom-jsx: the deprecated `effect-atom-jsx`
 * package, kept publishing for a transition window after the rename to
 * `@doeixd/affe` (docs/RENAME_AFFE.md). Every public subpath of the core
 * re-exports the matching `@doeixd/affe` subpath.
 *
 *   node scripts/generate-effect-atom-jsx-alias.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "deprecated/effect-atom-jsx");
const core = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

// Subpaths whose module also has a default export.
const withDefault = new Set(["./compiler/resume-extract-plugin"]);

fs.rmSync(path.join(out, "lib"), { recursive: true, force: true });
const exports = {};
for (const key of Object.keys(core.exports)) {
  if (key === "./package.json") continue;
  const target = key === "." ? core.name : `${core.name}/${key.slice(2)}`;
  const file = key === "." ? "index" : key.slice(2);
  let body = `export * from "${target}";\n`;
  if (withDefault.has(key)) body += `export { default } from "${target}";\n`;
  for (const ext of [".js", ".d.ts"]) {
    const dest = path.join(out, "lib", file + ext);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body);
  }
  exports[key] = { types: `./lib/${file}.d.ts`, import: `./lib/${file}.js` };
}
exports["./package.json"] = "./package.json";

const pkg = {
  name: "effect-atom-jsx",
  version: "0.6.0",
  description: `Deprecated: effect-atom-jsx is now Affe. Install ${core.name} instead; this package only re-exports it.`,
  author: core.author,
  license: core.license,
  type: "module",
  sideEffects: false,
  main: "./lib/index.js",
  types: "./lib/index.d.ts",
  exports,
  files: ["lib", "README.md"],
  dependencies: { [core.name]: core.version },
  repository: core.repository,
  homepage: core.homepage,
};
fs.writeFileSync(path.join(out, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
console.log(`wrote ${Object.keys(exports).length} subpaths to ${path.relative(root, out)}`);
