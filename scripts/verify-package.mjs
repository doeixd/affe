#!/usr/bin/env node
/**
 * verify-package — check the package exactly as npm would publish it.
 *
 * Packs the core (after `npm run build`), installs the tarball into a
 * throwaway project next to its `effect` peer, then:
 *   1. imports every public subpath from the package's `exports` map;
 *   2. type-checks a golden-path consumer file against the shipped `.d.ts`
 *      with `skipLibCheck: false`, under `bundler` and `nodenext` resolution;
 *   3. scaffolds a project with `create-affe`, installs it against the
 *      tarball, and runs its `build` (tsc + vite build with `@doeixd/affe/vite`).
 *
 * Usage: npm run build && node scripts/verify-package.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "affe-verify-"));
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });

try {
  const packed = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", work], root));
  const tarball = path.join(work, packed[0].filename);
  // The published add-on packages, packed the same way (build them first:
  // `npm run build:packages`).
  const addOns = ["agent", "css", "permissive"].map((dir) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "packages", dir, "package.json"), "utf8"));
    if (manifest.private) throw new Error(`packages/${dir} is private`);
    if (manifest.version !== pkg.version) throw new Error(`packages/${dir} is ${manifest.version}, core is ${pkg.version}`);
    const [info] = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", work], path.join(root, "packages", dir)));
    if (!info.files.some((file) => file.path === "dist/index.js")) throw new Error(`${manifest.name} packs no dist/ (run npm run build:packages)`);
    return { manifest, tarball: path.join(work, info.filename) };
  });
  const consumer = path.join(work, "consumer");
  fs.mkdirSync(path.join(consumer, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(consumer, "package.json"),
    JSON.stringify({ name: "affe-verify-consumer", private: true, type: "module" }),
  );
  run("npm", ["install", "--no-audit", "--no-fund", tarball, ...addOns.map((addOn) => addOn.tarball), `effect@${pkg.peerDependencies.effect}`], consumer);

  // 1. Every public subpath imports.
  const failures = [];
  let ok = 0;
  for (const key of Object.keys(pkg.exports)) {
    if (key === "./package.json") continue;
    const specifier = key === "." ? pkg.name : `${pkg.name}/${key.slice(2)}`;
    try {
      run(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(specifier)})`], consumer);
      ok += 1;
    } catch {
      failures.push(specifier);
    }
  }
  for (const { manifest } of addOns) {
    for (const key of Object.keys(manifest.exports)) {
      if (key === "./package.json") continue;
      const specifier = key === "." ? manifest.name : `${manifest.name}/${key.slice(2)}`;
      try {
        run(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(specifier)})`], consumer);
        ok += 1;
      } catch {
        failures.push(specifier);
      }
    }
  }
  if (failures.length > 0) throw new Error(`subpaths failed to import:\n  ${failures.join("\n  ")}`);
  console.log(`✓ ${ok} subpaths import (core and ${addOns.map((a) => a.manifest.name).join(", ")})`);

  // 2. The shipped types check strictly for a golden-path consumer.
  fs.writeFileSync(
    path.join(consumer, "src", "app.tsx"),
    `import { Atom, Behavior, Component, Element, Reactivity, Result, Style, View, renderToString } from "${pkg.name}";
import { Effect } from "effect";

export const count = Atom.make(0);
export const doubled = Atom.map(count, (n) => n * 2);
export const Users = Reactivity.Key.make("users");

const FieldSlots = View.Slots.define({
  root: { capability: Element.Capability.Container },
  input: { capability: Element.Capability.TextInput, allowedEvents: [View.Event.Input] },
});
const Field = Component.make(
  Component.props<{ readonly label: string }>(),
  Component.require<never>(),
  () => Effect.succeed({}),
  (props) => View.fromSlots(FieldSlots, <label><span>{props.label}</span><input /></label>),
).pipe(Component.withSlots(FieldSlots));
export const StyledField = Field.pipe(
  Style.attachToSlots(Style.make(FieldSlots, { root: Style.slot({ display: "grid", gap: "sm" }) }), FieldSlots),
  Behavior.attachToSlots(Behavior.forSlots(FieldSlots)((el) => Effect.succeed({ focus: () => el.input.focus() })), FieldSlots),
);
export const describe = (r: Result<number, string>) =>
  Result.builder(r).onLoading(() => "loading").onSuccess((n) => \`n=\${n}\`).onFailure((e) => \`e=\${e}\`).render();
export const html = () => renderToString(() => <p>{count()} {doubled()}</p>);
`,
  );
  fs.writeFileSync(
    path.join(consumer, "src", "add-ons.ts"),
    `import { Effect, Schema } from "effect";
import * as Agent from "${pkg.name}/Agent";
import * as Portable from "${pkg.name}/Portable";
import { mcpAuthLayer, mcpServer } from "@doeixd/affe-ui-agent";
import { cssLayerOrder, foundationStylesheet, tokenVariableName } from "@doeixd/affe-css";
import { permissiveClient } from "@doeixd/affe-permissive/client";

const addTodo = Portable.code({
  id: "todo.add",
  buildId: "my-app-build-1",
  captures: Schema.Struct({}),
  run: (_captures, title: string) => Effect.succeed({ title }),
});
const catalog = Agent.catalog({
  addTodo: Agent.expose(addTodo, {
    args: Schema.Tuple([Schema.String]),
    success: Schema.Struct({ title: Schema.String }),
    description: "Add a todo item",
    access: { agent: true },
  }),
});
export const callOnce = Effect.gen(function* () {
  const server = yield* mcpServer(catalog);
  const auth = mcpAuthLayer({ authenticate: () => Effect.succeed({ caller: "mcp", user: "user-42", lineage: undefined }) });
  return yield* server.callTool({ name: "addTodo", arguments: { title: "Ship it" } }).pipe(Effect.provide(auth));
});
export const css: string = foundationStylesheet() + tokenVariableName("space.md") + cssLayerOrder.join(",");
export const clientLayer = permissiveClient().layer;
`,
  );
  const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
  for (const [module, resolution] of [["ESNext", "bundler"], ["nodenext", "nodenext"]]) {
    fs.writeFileSync(
      path.join(consumer, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022", module, moduleResolution: resolution, strict: true, noEmit: true,
          jsx: "preserve", jsxImportSource: pkg.name, lib: ["ESNext", "DOM"], types: [], skipLibCheck: false,
        },
        include: ["src"],
      }),
    );
    run(process.execPath, [tsc, "-p", "tsconfig.json"], consumer);
    console.log(`✓ types check (${resolution})`);
  }
  // Apps may be on TypeScript 5: the shipped declarations must check there
  // too (the package itself builds with TypeScript 7).
  run("npm", ["install", "--no-audit", "--no-fund", "--no-save", "typescript@5.9"], consumer);
  run(process.execPath, [path.join(consumer, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], consumer);
  console.log("✓ types check with TypeScript 5.9");

  // 3. A project from create-affe installs, type-checks and builds against
  //    the packed core (its @doeixd/affe dependency points at the tarball).
  const app = path.join(work, "scaffolded-app");
  run(process.execPath, [path.join(root, "packages", "create-affe", "index.mjs"), app], work);
  const appPackagePath = path.join(app, "package.json");
  const appPackage = JSON.parse(fs.readFileSync(appPackagePath, "utf8"));
  appPackage.dependencies[pkg.name] = `file:${tarball}`;
  fs.writeFileSync(appPackagePath, JSON.stringify(appPackage, null, 2));
  run("npm", ["install", "--no-audit", "--no-fund"], app);
  run("npm", ["run", "build"], app);
  const assets = path.join(app, "dist", "assets");
  const built = fs.readdirSync(assets).filter((file) => file.endsWith(".js"));
  if (built.length === 0) throw new Error("create-affe app built no JavaScript");
  console.log("✓ create-affe app installs, type-checks and builds");

  // 4. Size budget for that app (Effect included). It was ~76 kB gzipped
  //    before tree-shaking was fixed (scripts/size.mjs has per-feature
  //    budgets); a jump past this means something reachable pulls in a whole
  //    module again.
  const gzipped = built.reduce((total, file) => total + zlib.gzipSync(fs.readFileSync(path.join(assets, file))).length, 0);
  const budget = 35 * 1024;
  if (gzipped > budget) {
    throw new Error(`create-affe app is ${(gzipped / 1024).toFixed(1)} kB gzipped, over the ${budget / 1024} kB budget`);
  }
  console.log(`✓ create-affe app is ${(gzipped / 1024).toFixed(1)} kB gzipped (budget ${budget / 1024} kB)`);
  console.log(`✓ ${packed[0].filename} verified`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
