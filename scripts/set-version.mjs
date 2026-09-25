#!/usr/bin/env node
/**
 * Set the version of every package that releases together: the core and
 * packages/{create-affe,agent,css,permissive}. The add-ons' peer range on the
 * core follows (`^<version>`). `src/__tests__/package.test.ts` fails if they
 * ever drift.
 *
 *   npm run set-version -- 0.7.0
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: npm run set-version -- <semver>  (for example 0.7.0 or 0.7.0-rc.1)");
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifests = ["package.json", ...["create-affe", "agent", "css", "permissive"].map((dir) => `packages/${dir}/package.json`)];
for (const relative of manifests) {
  const file = path.join(root, relative);
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  manifest.version = version;
  if (manifest.peerDependencies?.["@doeixd/affe"] !== undefined) {
    manifest.peerDependencies["@doeixd/affe"] = `^${version}`;
  }
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`${manifest.name} -> ${version}`);
}
console.log("\nNow run `npm install` to refresh package-lock.json, then add the release to CHANGELOG.md.");
