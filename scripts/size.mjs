#!/usr/bin/env node
/**
 * size — what an app pays for each Affe feature.
 *
 * Bundles small entry files against the BUILT package (dist/, resolved the
 * way an installed app resolves it) with Vite and `@doeixd/affe/vite`, and
 * reports the gzipped JavaScript loaded up front (lazy chunks are listed
 * separately). With `--check`, fails when a case exceeds its budget.
 *
 *   npm run build && npm run size            # report
 *   npm run size -- --check                  # enforce budgets (CI)
 *   npm run size -- --modules atoms          # which modules a case keeps
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import affe from "../dist/vite.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Each case: the entry source and its budget in gzipped kB (initial load). */
export const cases = {
  "effect runtime (baseline)": {
    budget: 8,
    code: `import { Effect } from "effect"; Effect.runFork(Effect.succeed(1));`,
  },
  "atoms": {
    budget: 7,
    code: `import { Atom } from "@doeixd/affe"; const n = Atom.make(1); const d = Atom.map(n, (x) => x * 2); n.set(2); console.log(d());`,
  },
  "atoms (subpath import)": {
    budget: 7,
    code: `import * as Atom from "@doeixd/affe/Atom"; const n = Atom.make(1); const d = Atom.map(n, (x) => x * 2); n.set(2); console.log(d());`,
  },
  "render + atoms": {
    budget: 23,
    code: `import { Atom, render } from "@doeixd/affe"; const n = Atom.make(1); render(() => <button onClick={() => n.update((x) => x + 1)}>{n()}</button>, document.body);`,
  },
  "component": {
    budget: 28,
    code: `import { Component, render } from "@doeixd/affe"; import { Effect } from "effect";
const C = Component.make(Component.props<{ label: string }>(), Component.require<never>(), () => Effect.succeed({}), (p) => <p>{p.label}</p>);
render(() => <C label="x" />, document.body);`,
  },
  "component + style + behavior": {
    budget: 33,
    code: `import { Behavior, Component, Element, Style, View, render } from "@doeixd/affe"; import { Effect } from "effect";
const S = View.Slots.define({ root: { capability: Element.Capability.Container }, input: { capability: Element.Capability.TextInput } });
const F = Component.make(Component.props<{}>(), Component.require<never>(), () => Effect.succeed({}), () => View.fromSlots(S, <label ref={View.Slot.ref(S, "root")}><input ref={View.Slot.ref(S, "input")} /></label>)).pipe(Component.withSlots(S));
const Styled = F.pipe(Style.attachToSlots(Style.make(S, { root: Style.slot({ display: "grid" }) }), S), Behavior.attachToSlots(Behavior.forSlots(S)((el) => Effect.succeed({ focus: () => el.input.focus() })), S));
render(() => <Styled />, document.body);`,
  },
  "router": {
    budget: 53,
    code: `import { Component, Route, WithLayer, render } from "@doeixd/affe";
const Home = Component.from<{}>(() => <h1>home</h1>).pipe(Component.route("/", { exact: true }));
const About = Component.from<{}>(() => <h1>about</h1>).pipe(Component.route("/about"));
render(() => <WithLayer layer={Route.Router.Browser}>{() => <Route.Switch children={[Home, About]} />}</WithLayer>, document.body);`,
  },
};

const args = process.argv.slice(2);
const check = args.includes("--check");
const modulesFor = args.includes("--modules") ? args[args.indexOf("--modules") + 1] : undefined;

// Build inside the repo so `@doeixd/affe` resolves through the package's own
// exports map to dist/, exactly as it would from node_modules.
const work = fs.mkdtempSync(path.join(root, ".size-"));
let failed = false;
try {
  for (const [name, spec] of Object.entries(cases)) {
    if (modulesFor !== undefined && !name.startsWith(modulesFor)) continue;
    const entry = path.join(work, "entry.tsx");
    fs.writeFileSync(entry, spec.code);
    const result = await build({
      root: work,
      configFile: false,
      logLevel: "silent",
      plugins: [affe()],
      build: { write: false, rollupOptions: { input: entry } },
    });
    const chunks = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output).filter((o) => o.type === "chunk");
    const byName = new Map(chunks.map((c) => [c.fileName, c]));
    const initial = new Set();
    const visit = (chunk) => {
      if (chunk === undefined || initial.has(chunk.fileName)) return;
      initial.add(chunk.fileName);
      for (const imported of chunk.imports) visit(byName.get(imported));
    };
    visit(chunks.find((c) => c.isEntry));
    let upFront = 0;
    let lazy = 0;
    const modules = new Map();
    for (const chunk of chunks) {
      const size = zlib.gzipSync(chunk.code).length;
      if (initial.has(chunk.fileName)) upFront += size;
      else lazy += size;
      if (!initial.has(chunk.fileName)) continue;
      for (const [id, info] of Object.entries(chunk.modules)) {
        const key = id.includes("/node_modules/effect/")
          ? (args.includes("--effect") ? id.replace(/.*\/node_modules\/effect\/dist\//, "effect/") : "effect")
          : id.replace(/.*\/dist\//, "affe/");
        modules.set(key, (modules.get(key) ?? 0) + info.renderedLength);
      }
    }
    const kb = upFront / 1024;
    const over = kb > spec.budget;
    if (over && check) failed = true;
    console.log(
      `${over ? "✗" : "✓"} ${name.padEnd(30)} ${kb.toFixed(1).padStart(5)} kB gz` +
        `${lazy > 0 ? `  (+${(lazy / 1024).toFixed(1)} kB lazy)` : ""}  budget ${spec.budget} kB`,
    );
    if (modulesFor !== undefined) {
      for (const [id, size] of [...modules].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
        console.log(`    ${(size / 1024).toFixed(1).padStart(6)} kB  ${id}`);
      }
    }
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
if (failed) {
  console.error("\nA case is over its budget. Run `npm run size -- --modules <case>` to see what it keeps.");
  process.exit(1);
}
