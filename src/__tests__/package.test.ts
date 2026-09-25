import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("package release surface", () => {
  it("keeps top-level namespaces available as tree-shakeable subpath exports", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
      readonly sideEffects?: unknown;
      readonly exports: Record<string, unknown>;
    };

    expect(pkg.sideEffects).toBe(false);
    expect(Object.keys(pkg.exports)).toEqual(expect.arrayContaining([
      ".",
      "./runtime",
      "./jsx-runtime",
      "./testing",
      "./advanced",
      "./Atom",
      "./View",
      "./Component",
      "./Behavior",
      "./Machine",
      "./Mixin",
      "./Agent",
      "./Style",
      "./Route",
      "./ServerRoute",
      "./RouterRuntime",
      "./Serialization",
      "./Portable",
      "./Resume",
      "./adapter-spi",
      "./Diagnostics",
      "./A11y",
      "./Form",
      "./Devtools",
      "./Event",
      "./Registry",
      "./package.json",
    ]));
  });

  it("releases every public workspace package in step with the core", () => {
    const core = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
      readonly version: string;
      readonly peerDependencies: Record<string, string>;
    };
    for (const dir of ["agent", "css", "permissive"]) {
      const addOn = JSON.parse(fs.readFileSync(`packages/${dir}/package.json`, "utf8")) as {
        readonly name: string;
        readonly private?: boolean;
        readonly version: string;
        readonly files: ReadonlyArray<string>;
        readonly dependencies?: Record<string, string>;
        readonly peerDependencies: Record<string, string>;
      };
      expect(addOn.private, addOn.name).toBeUndefined();
      expect(addOn.version, addOn.name).toBe(core.version);
      // The core is a peer (one copy in an app), never a bundled dependency,
      // and never the repo-local `file:` link.
      expect(addOn.dependencies?.["@doeixd/affe"], addOn.name).toBeUndefined();
      expect(addOn.peerDependencies["@doeixd/affe"], addOn.name).toBe(`^${core.version}`);
      expect(addOn.peerDependencies.effect, addOn.name).toBe(core.peerDependencies.effect);
      expect(addOn.files, addOn.name).toEqual(expect.arrayContaining(["dist", "README.md", "LICENSE"]));
      expect(fs.existsSync(`packages/${dir}/README.md`), addOn.name).toBe(true);
      expect(fs.existsSync(`packages/${dir}/LICENSE`), addOn.name).toBe(true);
    }
  });

  it("is published as @doeixd/affe", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as { readonly name: string };
    expect(pkg.name).toBe("@doeixd/affe");
  });

  it("points every declared import and type export at an existing build artifact", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
      readonly exports: Record<string, string | Record<string, string>>;
      readonly bin: Record<string, string>;
    };

    for (const [name, entry] of Object.entries(pkg.exports)) {
      const fields = typeof entry === "string" ? { import: entry } : entry;
      for (const key of ["import", "types", "default"] as const) {
        const target = fields[key];
        if (target === undefined || target === "./package.json") continue;
        expect(fs.existsSync(target), `${name}.${key} -> ${target}`).toBe(true);
      }
    }

    for (const [name, target] of Object.entries(pkg.bin)) {
      expect(fs.existsSync(target), `bin ${name} -> ${target}`).toBe(true);
    }
  });
});
