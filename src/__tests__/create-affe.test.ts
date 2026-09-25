/**
 * `@doeixd/create-affe` writes a project that runs: Vite with the Affe
 * plugin, the core at this release, and the toolchain the core itself builds
 * with. `npm run verify:package` goes further and installs and builds one.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const script = path.resolve("packages/create-affe/index.mjs");
const core = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
  readonly version: string;
  readonly peerDependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
};

const scaffold = (...args: ReadonlyArray<string>) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

describe("create-affe", () => {
  it("releases in step with the core", () => {
    const self = JSON.parse(fs.readFileSync("packages/create-affe/package.json", "utf8")) as { readonly version: string };
    expect(self.version).toBe(core.version);
  });

  it("scaffolds a Vite project wired to @doeixd/affe/vite", () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "create-affe-")), "My App");
    const result = scaffold(dir);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("npm run dev");

    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    expect(pkg.name).toBe("my-app");
    expect(pkg.scripts.dev).toBe("vite");
    expect(pkg.dependencies["@doeixd/affe"]).toBe(`^${core.version}`);
    expect(pkg.dependencies.effect).toBe(core.peerDependencies.effect);
    for (const tool of ["vite", "typescript", "@babel/core", "@babel/preset-typescript", "babel-plugin-jsx-dom-expressions"]) {
      expect(pkg.devDependencies[tool], tool).toBe(core.devDependencies[tool]);
    }

    expect(fs.readFileSync(path.join(dir, "vite.config.ts"), "utf8")).toContain(`import affe from "@doeixd/affe/vite";`);
    const tsconfig = JSON.parse(fs.readFileSync(path.join(dir, "tsconfig.json"), "utf8"));
    expect(tsconfig.compilerOptions.jsxImportSource).toBe("@doeixd/affe");
    expect(tsconfig.compilerOptions.lib).toContain("ESNext");
    for (const file of ["index.html", "src/main.tsx", "src/App.tsx", "src/Field.tsx", ".gitignore", "README.md"]) {
      expect(fs.existsSync(path.join(dir, file)), file).toBe(true);
    }
    const field = fs.readFileSync(path.join(dir, "src", "Field.tsx"), "utf8");
    expect(field).toContain("View.Slots.define");
    expect(field).toContain("Component.withSlots");
    expect(field).toContain("Style.attachToSlots");
    expect(field).toContain(`<input ref={View.Slot.ref(FieldSlots, "input")} />`);
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  });

  it("refuses a non-empty directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "create-affe-"));
    fs.writeFileSync(path.join(dir, "keep.txt"), "x");
    const result = scaffold(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not empty");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("adds a component to an existing project", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "create-affe-"));
    expect(scaffold("--component", "SearchBox", dir).status).toBe(0);
    expect(fs.readFileSync(path.join(dir, "SearchBox.tsx"), "utf8")).toContain("export const StyledSearchBox");
    expect(scaffold("--component", "searchBox", dir).status).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
