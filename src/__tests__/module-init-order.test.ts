/**
 * Every public module must be importable FIRST in a fresh module graph.
 * Regression: `Element -> style-runtime -> Theme` closed a cycle through
 * `Atom -> effect-ts -> dom -> View -> Element`, and `Theme` builds an
 * Atom-backed layer at load time, so `import "@doeixd/affe/Atom"` threw
 * "Cannot access 'writable' before initialization".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const modules = {
  Atom: () => import("../Atom.js"),
  Style: () => import("../Style.js"),
  Component: () => import("../Component.js"),
  Element: () => import("../Element.js"),
  View: () => import("../View.js"),
  Theme: () => import("../Theme.js"),
} as const;

describe("module initialization order", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  for (const [name, load] of Object.entries(modules)) {
    it(`${name} loads first in a fresh module graph`, async () => {
      await expect(load()).resolves.toBeDefined();
    });
  }
});
