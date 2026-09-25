#!/usr/bin/env node
/**
 * create-affe — scaffold a working Affe app, or add a component.
 *
 *   npm create @doeixd/affe@latest my-app
 *   npm create @doeixd/affe@latest -- --component SearchBox [out-dir]
 *
 * The project is Vite + `@doeixd/affe/vite` + strict TypeScript: after
 * `npm install`, `npm run dev` serves it and `npm run build` bundles it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const self = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"));

/**
 * Versions written into a new project. `@doeixd/affe` follows this package's
 * own version (they release together); the rest are kept in step with the
 * core package's toolchain by `src/__tests__/scaffold.test.ts`.
 */
const versions = {
  affe: `^${self.version}`,
  effect: "4.0.0-rc.117",
  vite: "^8.3.1",
  typescript: "^7.0.2",
  babelCore: "^7.29.7",
  babelPresetTypescript: "^7.29.7",
  jsxDomExpressions: "^0.40.10",
};

function usage() {
  console.log(`Create an Affe app:

  npm create @doeixd/affe@latest <project-dir>

Add a slot-contract component to an existing project:

  npm create @doeixd/affe@latest -- --component <Name> [out-dir]
`);
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

const json = (value) => JSON.stringify(value, null, 2) + "\n";

function componentSource(name) {
  return `import { Effect } from "effect";
import { Behavior, Component, Element, Style, View } from "@doeixd/affe";

// The public structure of the component: named slots with the capabilities
// and events each one allows. Styles and behaviors target these names.
export const ${name}Slots = View.Slots.define({
  root: { capability: Element.Capability.Container },
  label: { capability: Element.Capability.Container },
  input: {
    capability: Element.Capability.TextInput,
    allowedEvents: [View.Event.Input, View.Event.Focus],
  },
});

export const ${name} = Component.make(
  Component.props<{ readonly label: string }>(),
  Component.require<never>(),
  () => Effect.succeed({}),
  // \`ref={View.Slot.ref(Slots, name)}\` binds each slot to its element, so
  // attached styles, attributes and listeners reach the rendered page.
  (props) =>
    View.fromSlots(${name}Slots, (
      <label ref={View.Slot.ref(${name}Slots, "root")}>
        <span ref={View.Slot.ref(${name}Slots, "label")}>{props.label}</span>
        <input ref={View.Slot.ref(${name}Slots, "input")} />
      </label>
    )),
).pipe(Component.withSlots(${name}Slots));

export const ${name}Style = Style.make(${name}Slots, {
  root: Style.slot({ display: "grid", gap: 4 }),
  label: Style.slot({ fontWeight: 600 }),
  input: Style.slot({ padding: 8, borderRadius: 6, border: "1px solid #bbb" }),
});

export const ${name}Behavior = Behavior.forSlots(${name}Slots)((elements) =>
  Effect.succeed({
    focus: () => elements.input.focus(),
  }),
);

// Style and behavior attach from outside the component.
export const Styled${name} = ${name}.pipe(
  Style.attachToSlots(${name}Style, ${name}Slots),
  Behavior.attachToSlots(${name}Behavior, ${name}Slots),
);
`;
}

function scaffoldComponent(name, outDir) {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    console.error(`Component names are PascalCase identifiers (got "${name}").`);
    process.exit(1);
  }
  const file = path.join(outDir, `${name}.tsx`);
  if (fs.existsSync(file)) {
    console.error(`${file} already exists.`);
    process.exit(1);
  }
  write(file, componentSource(name));
  console.log(`Created ${path.relative(process.cwd(), file) || file}`);
}

function packageManager() {
  const agent = process.env.npm_config_user_agent ?? "";
  if (agent.startsWith("pnpm")) return "pnpm";
  if (agent.startsWith("yarn")) return "yarn";
  if (agent.startsWith("bun")) return "bun";
  return "npm";
}

function scaffoldProject(dir) {
  const root = path.resolve(dir);
  if (fs.existsSync(root) && fs.readdirSync(root).length > 0) {
    console.error(`${root} is not empty. Choose a new directory.`);
    process.exit(1);
  }
  const name = path.basename(root).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");

  write(path.join(root, "package.json"), json({
    name,
    private: true,
    version: "0.0.0",
    type: "module",
    scripts: {
      dev: "vite",
      build: "tsc --noEmit && vite build",
      preview: "vite preview",
      typecheck: "tsc --noEmit",
    },
    dependencies: {
      "@doeixd/affe": versions.affe,
      effect: versions.effect,
    },
    devDependencies: {
      "@babel/core": versions.babelCore,
      "@babel/preset-typescript": versions.babelPresetTypescript,
      "babel-plugin-jsx-dom-expressions": versions.jsxDomExpressions,
      typescript: versions.typescript,
      vite: versions.vite,
    },
  }));

  write(path.join(root, "tsconfig.json"), json({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      // Effect's types use `Disposable`, which lives in ESNext.
      lib: ["ESNext", "DOM", "DOM.Iterable"],
      jsx: "preserve",
      jsxImportSource: "@doeixd/affe",
      types: ["vite/client"],
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      isolatedModules: true,
      verbatimModuleSyntax: true,
    },
    include: ["src", "vite.config.ts"],
  }));

  write(path.join(root, "vite.config.ts"), `import { defineConfig } from "vite";
import affe from "@doeixd/affe/vite";

export default defineConfig({
  plugins: [affe()],
});
`);

  write(path.join(root, "index.html"), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="data:," />
    <title>${name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`);

  write(path.join(root, "src", "main.tsx"), `import { renderWithHMR } from "@doeixd/affe";
import { App } from "./App.js";

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root element");

// Re-renders in place when Vite hot-reloads a module.
renderWithHMR(() => <App />, root, import.meta.hot);
`);

  write(path.join(root, "src", "App.tsx"), `import { Atom } from "@doeixd/affe";
import { StyledField } from "./Field.js";

// Atoms are callable, writable, fine-grained state. Reading one inside JSX
// subscribes exactly that text node.
const count = Atom.make(0);
const doubled = Atom.map(count, (n) => n * 2);

export function App() {
  return (
    <main style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; display: grid; gap: 1.5rem">
      <h1>${name}</h1>
      <section>
        <p>
          Count: <strong data-testid="count">{count()}</strong> (doubled: {doubled()})
        </p>
        <button onClick={() => count.update((n) => n - 1)}>-1</button>{" "}
        <button onClick={() => count.update((n) => n + 1)}>+1</button>
      </section>
      <StyledField label="Your name" />
    </main>
  );
}
`);

  write(path.join(root, "src", "Field.tsx"), componentSource("Field"));

  write(path.join(root, ".gitignore"), "node_modules\ndist\n");

  const pm = packageManager();
  const run = pm === "npm" ? "npm run" : pm;
  write(path.join(root, "README.md"), `# ${name}

An [Affe](https://github.com/doeixd/affe) app.

\`\`\`sh
${pm} install
${run} dev        # start the dev server
${run} build      # type-check and bundle into dist/
\`\`\`

- \`src/App.tsx\` — a counter built on atoms.
- \`src/Field.tsx\` — a slot-contract component with a style and a behavior
  attached from outside.
- \`vite.config.ts\` — \`@doeixd/affe/vite\` compiles the JSX.
`);

  const relative = path.relative(process.cwd(), root) || ".";
  console.log(`
Created ${relative}. Next:

  cd ${relative}
  ${pm} install
  ${run} dev
`);
}

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  usage();
  process.exit(args.length === 0 ? 1 : 0);
}
if (args[0] === "--component") {
  const name = args[1];
  if (!name) {
    usage();
    process.exit(1);
  }
  scaffoldComponent(name, path.resolve(args[2] ?? "src"));
} else {
  scaffoldProject(args[0]);
}
