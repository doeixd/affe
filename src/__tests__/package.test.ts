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

  it("keeps the deprecated effect-atom-jsx alias re-exporting every core subpath", () => {
    const core = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
      readonly name: string;
      readonly version: string;
      readonly exports: Record<string, unknown>;
    };
    const alias = JSON.parse(fs.readFileSync("deprecated/effect-atom-jsx/package.json", "utf8")) as {
      readonly name: string;
      readonly dependencies: Record<string, string>;
      readonly exports: Record<string, string | Record<string, string>>;
    };

    expect(core.name).toBe("@doeixd/affe");
    expect(alias.name).toBe("effect-atom-jsx");
    expect(alias.dependencies[core.name], "regenerate with scripts/generate-effect-atom-jsx-alias.mjs").toBe(core.version);
    expect(Object.keys(alias.exports).sort()).toEqual(Object.keys(core.exports).sort());

    for (const [key, entry] of Object.entries(alias.exports)) {
      if (typeof entry === "string") continue;
      const target = key === "." ? core.name : `${core.name}/${key.slice(2)}`;
      for (const file of [entry.import, entry.types]) {
        const source = fs.readFileSync(`deprecated/effect-atom-jsx/${file}`, "utf8");
        expect(source, `${key} -> ${file}`).toContain(`export * from "${target}";`);
      }
    }
  });
});
