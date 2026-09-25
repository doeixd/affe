/**
 * Regression coverage for the hydration audit: strict mode is a typed
 * failure in the Effect variants (not a defect) and a thrown
 * `HydrationError` in the sync variants, and a strict mismatch writes
 * nothing.
 */
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import * as Atom from "../Atom.js";
import * as Hydration from "../Hydration.js";
import * as Registry from "../Registry.js";

const entry = (key: string, value: unknown): Hydration.DehydratedAtomValue => ({
  "~affe/DehydratedAtom": true,
  key,
  value,
  dehydratedAt: 0,
});

const member = (
  family: string,
  args: ReadonlyArray<unknown>,
  value: unknown,
): Hydration.DehydratedFamilyValue => ({
  "~affe/DehydratedAtom": true,
  family,
  args,
  value,
  dehydratedAt: 0,
});

function failureOf<E>(exit: Exit.Exit<unknown, E>): E | undefined {
  if (Exit.isSuccess(exit)) return undefined;
  const found = Cause.findErrorOption(exit.cause);
  return found._tag === "Some" ? found.value : undefined;
}

describe("Effect variants fail with a typed HydrationError (bug 7)", () => {
  it("hydrateEffect strict unknown key is a typed failure, not a defect", () => {
    const registry = Registry.make();
    const count = Atom.make(1);
    const exit = Effect.runSyncExit(
      Hydration.hydrateEffect(registry, [entry("count", 2), entry("gone", 1)], { count }, { strict: true }),
    );
    expect(failureOf(exit)).toEqual({ _tag: "HydrationUnknownKeys", keys: ["gone"] });
    // Validation precedes writes: a mismatched payload never half-hydrates.
    expect(registry.get(count)).toBe(1);
  });

  it("hydrateEffect strict missing key is a typed failure", () => {
    const registry = Registry.make();
    const a = Atom.make(1);
    const b = Atom.make(1);
    const exit = Effect.runSyncExit(
      Hydration.hydrateEffect(registry, [entry("a", 5)], { a, b }, { mode: "strict" }),
    );
    expect(failureOf(exit)).toEqual({ _tag: "HydrationMissingKeys", keys: ["b"] });
  });

  it("hydrateEffect strict can be recovered with catchTag", () => {
    const registry = Registry.make();
    const count = Atom.make(1);
    const recovered = Effect.runSync(
      Hydration.hydrateEffect(registry, [entry("gone", 1)], { count }, { strict: true }).pipe(
        Effect.catchTag("HydrationUnknownKeys", (e) => Effect.succeed(e.keys)),
      ),
    );
    expect(recovered).toEqual(["gone"]);
  });

  it("hydrateFamiliesEffect strict is a typed failure", () => {
    const registry = Registry.make();
    const known = Atom.family((id: number) => Atom.make(id));
    const exit = Effect.runSyncExit(
      Hydration.hydrateFamiliesEffect(
        registry,
        [member("known", [1], 10), member("gone", [1], 5)],
        { known },
        { mode: "strict" },
      ),
    );
    expect(failureOf(exit)).toEqual({ _tag: "HydrationUnknownKeys", keys: ["gone([1])"] });
    expect(registry.get(known(1))).toBe(1);
  });

  it("succeeds and writes when strict keys match", () => {
    const registry = Registry.make();
    const count = Atom.make(1);
    Effect.runSync(Hydration.hydrateEffect(registry, [entry("count", 9)], { count }, { strict: true }));
    expect(registry.get(count)).toBe(9);
  });
});

describe("sync variants throw in strict mode (bug 8)", () => {
  it("hydrate strict throws on an unknown key and writes nothing", () => {
    const registry = Registry.make();
    const count = Atom.make(1);
    let thrown: unknown;
    try {
      Hydration.hydrate(registry, [entry("count", 3), entry("gone", 1)], { count }, { mode: "strict" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toEqual({ _tag: "HydrationUnknownKeys", keys: ["gone"] });
    expect(registry.get(count)).toBe(1);
  });

  it("hydrate { strict: true } throws on a missing key", () => {
    const registry = Registry.make();
    const a = Atom.make(1);
    const b = Atom.make(1);
    expect(() => Hydration.hydrate(registry, [entry("a", 2)], { a, b }, { strict: true }))
      .toThrow(expect.objectContaining({ _tag: "HydrationMissingKeys", keys: ["b"] }) as never);
  });

  it("hydrateFamilies strict throws on a missing family", () => {
    const registry = Registry.make();
    const known = Atom.family((id: number) => Atom.make(id));
    const other = Atom.family((id: number) => Atom.make(id));
    let thrown: unknown;
    try {
      Hydration.hydrateFamilies(registry, [member("known", [1], 10)], { known, other }, { mode: "strict" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toEqual({ _tag: "HydrationMissingKeys", keys: ["other"] });
    expect(registry.get(known(1))).toBe(1);
  });

  it("hydrate loose still completes", () => {
    const registry = Registry.make();
    const count = Atom.make(1);
    const unknown: string[] = [];
    Hydration.hydrate(registry, [entry("count", 4), entry("gone", 1)], { count }, {
      mode: "loose",
      onUnknownKey: (k) => unknown.push(k),
    });
    expect(unknown).toEqual(["gone"]);
    expect(registry.get(count)).toBe(4);
  });
});
