#!/usr/bin/env node
/**
 * check-docs — catch documentation that names API which does not exist.
 *
 * Extracts every ```ts / ```tsx block from the README, the guides and the
 * package READMEs, type-checks them against the BUILT package, and reports
 * only API drift:
 *
 *   - importing a name a module does not export,
 *   - `Namespace.member` where the namespace has no such member,
 *   - importing a module or subpath that does not exist.
 *
 * Doc snippets are fragments (they use variables defined in prose), so every
 * other type error is ignored on purpose. Blocks can use the Affe and Effect
 * namespaces without importing them; the checker adds the imports.
 *
 * A block preceded by `<!-- check-docs: skip -->` is not checked (for code
 * that shows removed or wrong API on purpose).
 *
 *   npm run build && npm run check:docs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const docs = [
  "README.md",
  "llms.txt",
  ...fs.readdirSync(path.join(root, "docs"))
    .filter((file) => /^(state|component|view|style|router|reactivity|afui)\.md$|^(SERVICES_AND_LAYERS|TESTING|RESUMABILITY_GUIDE|AGENT_SURFACE_GUIDE|SLOT_CONTRACT_GOLDEN_PATH|API)\.md$/.test(file))
    .map((file) => `docs/${file}`),
  ...["agent", "css", "permissive", "create-affe"].map((dir) => `packages/${dir}/README.md`),
];

// Names snippets may use without importing them.
const indexSource = fs.readFileSync(path.join(root, "src", "index.ts"), "utf8");
const affeNamespaces = [...indexSource.matchAll(/export \* as (\w+) from/g)].map((m) => m[1]);
const affeNames = [
  ...affeNamespaces,
  "render", "renderToString", "renderToStream", "hydrateRoot", "mount", "createMount", "useService",
  "Async", "Loading", "Errored", "TypedBoundary", "Show", "For", "Switch", "Match", "MatchTag",
  "Optional", "MatchOption", "Dynamic", "WithLayer", "Result", "defineQuery", "defineMutation",
];
const effectNames = [
  "Effect", "Layer", "Context", "Schema", "Stream", "Option", "Schedule", "Scope", "Exit",
  "Duration", "Fiber", "Queue", "Cause", "Data", "PubSub", "ManagedRuntime", "Ref", "pipe",
];

const work = fs.mkdtempSync(path.join(root, ".check-docs-"));
const sources = new Map(); // generated file -> { doc, line, prelude }
let skipped = 0;
try {
  for (const doc of docs) {
    const text = fs.readFileSync(path.join(root, doc), "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const open = /^\s*```(ts|tsx|typescript)\s*$/.exec(lines[i]);
      if (open === null) continue;
      let end = i + 1;
      while (end < lines.length && !/^\s*```\s*$/.test(lines[end])) end += 1;
      const previous = lines.slice(Math.max(0, i - 2), i).join("\n");
      const body = lines.slice(i + 1, end).join("\n");
      if (/check-docs:\s*skip/.test(previous)) {
        skipped += 1;
      } else {
        const imported = new Set(
          [...body.matchAll(/import\s+(?:type\s+)?(?:\*\s+as\s+(\w+)|\{([^}]*)\}|(\w+))/g)]
            .flatMap((m) => (m[2] ?? m[1] ?? m[3] ?? "").split(",").map((name) => name.trim().split(/\s+as\s+/).pop()))
            .filter(Boolean),
        );
        const used = (name) => new RegExp(`(^|[^.\\w$])${name}\\b`).test(body);
        const affe = affeNames.filter((name) => !imported.has(name) && used(name));
        const effect = effectNames.filter((name) => !imported.has(name) && used(name));
        const prelude = [
          affe.length > 0 ? `import { ${affe.join(", ")} } from "@doeixd/affe";` : "",
          effect.length > 0 ? `import { ${effect.join(", ")} } from "effect";` : "",
          "export {};",
        ].join("\n");
        const file = path.join(work, `${doc.replace(/[/.]/g, "_")}_${i + 1}.tsx`);
        fs.writeFileSync(file, `${prelude}\n${body}\n`);
        sources.set(path.basename(file), { doc, line: i + 2, preludeLines: prelude.split("\n").length });
      }
      i = end;
    }
  }

  const tsc = (include) => {
    fs.writeFileSync(path.join(work, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "ES2022", module: "ESNext", moduleResolution: "bundler", strict: false, noEmit: true,
        jsx: "preserve", jsxImportSource: "@doeixd/affe", lib: ["ESNext", "DOM"], types: ["node"], skipLibCheck: true,
      },
      files: include,
    }));
    try {
      execFileSync(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json", "--pretty", "false"], {
        cwd: work, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024,
      });
      return [];
    } catch (error) {
      return String(error.stdout ?? "").split("\n").flatMap((line) => {
        const m = /^(.+?\.tsx)\((\d+),(\d+)\): error TS(\d+): (.*)$/.exec(line);
        return m === null ? [] : [{ file: path.basename(m[1]), row: Number(m[2]), code: Number(m[4]), message: m[5] }];
      });
    }
  };

  // tsc skips type-checking entirely when any file has a syntax error (TS1xxx),
  // so pass one finds the blocks that are pseudo-code and pass two checks the rest.
  const unparsable = new Set(tsc([...sources.keys()]).filter((d) => d.code < 2000).map((d) => d.file));
  const driftCodes = new Set([2305, 2307, 2614, 2694, 2724]);
  const drift = [];
  for (const d of tsc([...sources.keys()].filter((file) => !unparsable.has(file)))) {
    const isDrift = driftCodes.has(d.code) || (d.code === 2339 && /typeof import\(/.test(d.message));
    const origin = sources.get(d.file);
    if (!isDrift || origin === undefined || d.row <= origin.preludeLines) continue;
    if (/module '\.\.?\//.test(d.message)) continue; // a file of the reader's app
    drift.push(`${origin.doc}:${origin.line + d.row - origin.preludeLines - 1}  ${d.message.replace(/import\("[^"]*\/(dist|node_modules)\//g, 'import("')}`);
  }

  console.log(`checked ${sources.size} snippets in ${docs.length} documents${skipped > 0 ? ` (${skipped} skipped)` : ""}`);
  if (unparsable.size > 0) console.log(`${unparsable.size} do not parse (pseudo-code) and are not checked: ${[...unparsable].map((file) => `${sources.get(file).doc}:${sources.get(file).line - 1}`).join(", ")}`);
  if (drift.length > 0) {
    console.log(`\n${drift.length} reference(s) to API that does not exist:\n`);
    for (const entry of [...new Set(drift)].sort()) console.log(`  ${entry}`);
    process.exitCode = 1;
  } else {
    console.log("✓ no references to missing API");
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
