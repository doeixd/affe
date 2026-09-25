/**
 * reactive-core-fixes.test.ts — Regression tests for audited reactive-core bugs.
 *
 * Each describe block pins one audited defect: dependency reconciliation,
 * shared query ownership, query refresh/reactivity, diamond glitches,
 * self-writes inside a running effect, single-flight form rollback,
 * subscribe de-duplication, family prefix eviction, and AtomRef granularity.
 */

import { describe, expect, it } from "vitest";
import { Effect, Layer, Schema } from "effect";
import {
  batch,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
} from "../api.js";
import * as Atom from "../Atom.js";
import * as AtomRef from "../AtomRef.js";
import * as Form from "../Form.js";

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe("dependency reconciliation (bug 1)", () => {
  it("keeps a re-read dependency subscribed when a new dependency is inserted before it", () => {
    const [flag, setFlag] = createSignal(false);
    const [b, setB] = createSignal(0);
    const [c] = createSignal(0);
    const log: number[] = [];
    createRoot(() =>
      createEffect(() => {
        if (flag()) c();
        log.push(b());
      }),
    );
    setFlag(true);
    flush();
    setB(1);
    flush();
    expect(log).toEqual([0, 0, 1]);
  });

  it("keeps dependencies subscribed when read order swaps", () => {
    const [x, setX] = createSignal(0);
    const [a, setA] = createSignal(0);
    const [b] = createSignal(0);
    let runs = 0;
    createRoot(() =>
      createEffect(() => {
        runs++;
        if (x() > 0) {
          b();
          a();
        } else {
          a();
          b();
        }
      }),
    );
    setX(1);
    flush();
    setA(1);
    flush();
    expect(runs).toBe(3);
  });

  it("keeps a memo's re-read dependency subscribed after a new dependency is inserted", () => {
    const [flag, setFlag] = createSignal(false);
    const [b, setB] = createSignal(0);
    const [c] = createSignal(10);
    let m!: () => number;
    createRoot(() => {
      m = createMemo(() => (flag() ? c() : 0) + b());
    });
    setFlag(true);
    flush();
    expect(m()).toBe(10);
    setB(1);
    flush();
    expect(m()).toBe(11);
  });

  it("does not unsubscribe a prefix dependency that also appeared later in the old list", () => {
    const [a, setA] = createSignal(0);
    const [x] = createSignal(0);
    const [mode, setMode] = createSignal(0);
    let runs = 0;
    createRoot(() =>
      createEffect(() => {
        runs++;
        a();
        if (mode() === 0) {
          x();
          a();
        }
      }),
    );
    setMode(1);
    flush();
    setA(1);
    flush();
    expect(runs).toBe(3);
  });
});

describe("shared query ownership (bug 2)", () => {
  it("Atom.effect keeps updating after the reader re-runs", async () => {
    const id = Atom.make(1);
    const q = Atom.effect(() => {
      const n = id();
      return Effect.sleep("1 millis").pipe(Effect.as(n * 10));
    });
    const dispose = createRoot((d) => {
      createEffect(() => {
        q();
      });
      return d;
    });
    await tick();
    flush();
    id.set(2);
    await tick();
    flush();
    expect(q()).toMatchObject({ _tag: "Success", value: 20 });
    dispose();
  });

  it("Atom.effect in-flight fiber survives an unrelated reader re-run", async () => {
    const [o, setO] = createSignal(0);
    const q = Atom.effect(() => Effect.sleep("5 millis").pipe(Effect.as(42)));
    const dispose = createRoot((d) => {
      createEffect(() => {
        o();
        q();
      });
      return d;
    });
    setO(1);
    flush();
    await tick();
    flush();
    expect(q()._tag).toBe("Success");
    dispose();
  });

  it("runtime.atom in-flight fiber survives an unrelated reader re-run", async () => {
    const rt = Atom.runtime(Layer.empty);
    const [o, setO] = createSignal(0);
    const q = rt.atom(Effect.sleep("5 millis").pipe(Effect.as(42)));
    const dispose = createRoot((d) => {
      createEffect(() => {
        o();
        q();
      });
      return d;
    });
    setO(1);
    flush();
    await tick();
    flush();
    expect(q()).toMatchObject({ _tag: "Success", value: 42 });
    dispose();
    await rt.dispose();
  });

  it("a query outlives the root that first read it", async () => {
    const q = Atom.effect(() => Effect.sleep("1 millis").pipe(Effect.as(7)));
    const dispose = createRoot((d) => {
      createEffect(() => {
        q();
      });
      return d;
    });
    dispose();
    await tick();
    flush();
    expect(q()).toMatchObject({ _tag: "Success", value: 7 });
  });
});

describe("query refresh and reactivity keys (bug 3)", () => {
  it("Atom.refresh re-runs a runtime.atom query", async () => {
    const rt = Atom.runtime(Layer.empty);
    let runs = 0;
    const q = rt.atom(Effect.sync(() => ++runs));
    const stop = Atom.subscribe(q, () => {});
    await tick();
    flush();
    Effect.runSync(Atom.refresh(q));
    await tick();
    flush();
    expect(runs).toBe(2);
    expect(q()).toMatchObject({ _tag: "Success", value: 2 });
    stop();
    await rt.dispose();
  });

  it("Atom.refresh re-runs an Atom.effect query", async () => {
    let runs = 0;
    const q = Atom.effect(() => Effect.sync(() => ++runs));
    const stop = Atom.subscribe(q, () => {});
    await tick();
    flush();
    Effect.runSync(Atom.refresh(q));
    await tick();
    flush();
    expect(runs).toBe(2);
    stop();
  });

  it("an action's reactivityKeys re-run a withReactivity-wrapped runtime.atom", async () => {
    const rt = Atom.runtime(Layer.empty);
    let runs = 0;
    const q = Atom.withReactivity(rt.atom(Effect.sync(() => ++runs)), ["todos"]);
    const stop = Atom.subscribe(q, () => {});
    await tick();
    flush();
    rt.action((_: void) => Effect.void, { reactivityKeys: ["todos"] })();
    await tick();
    flush();
    expect(runs).toBe(2);
    stop();
    await rt.dispose();
  });

  it("the pipeable withReactivity form forwards Atom.refresh to the wrapped query", async () => {
    const rt = Atom.runtime(Layer.empty);
    let runs = 0;
    const q = rt.atom(Effect.sync(() => ++runs)).pipe(Atom.withReactivity(["users"])) as Atom.Atom<unknown>;
    const stop = Atom.subscribe(q, () => {});
    await tick();
    flush();
    Effect.runSync(Atom.refresh(q));
    await tick();
    flush();
    expect(runs).toBe(2);
    Atom.invalidateReactivity(["users"]);
    await tick();
    flush();
    expect(runs).toBe(3);
    stop();
    await rt.dispose();
  });
});

describe("diamond glitches (bug 4)", () => {
  it("an effect never observes a half-updated diamond of memos", () => {
    const [s, setS] = createSignal(1);
    const seen: Array<[number, number]> = [];
    createRoot(() => {
      const a = createMemo(() => s() * 2);
      const b = createMemo(() => s() * 3);
      createEffect(() => {
        seen.push([a(), b()]);
      });
    });
    setS(2);
    flush();
    expect(seen).toEqual([[2, 3], [4, 6]]);
  });

  it("an effect reading a signal and a memo of it runs once per change", () => {
    const [s, setS] = createSignal(1);
    let runs = 0;
    const seen: Array<[number, number]> = [];
    createRoot(() => {
      const m = createMemo(() => s() + 1);
      createEffect(() => {
        runs++;
        seen.push([s(), m()]);
      });
    });
    setS(2);
    flush();
    expect(runs).toBe(2);
    expect(seen).toEqual([[1, 2], [2, 3]]);
  });
});

describe("self-write inside a running effect (bug 5)", () => {
  it("a batched self-write re-runs the effect after the current run", async () => {
    const [s, setS] = createSignal(0);
    const log: number[] = [];
    createRoot(() =>
      createEffect(() => {
        const v = s();
        log.push(v);
        if (v < 2) batch(() => setS(v + 1));
      }),
    );
    await new Promise((r) => setTimeout(r, 5));
    flush();
    expect(s()).toBe(2);
    expect(log).toEqual([0, 1, 2]);
  });
});

describe("single-flight form submit rollback (bug 6)", () => {
  it("rolls back optimistic state when onSubmit dies", async () => {
    const log: string[] = [];
    const f = Form.make(
      { a: { schema: Schema.String, initial: "x" } },
      {
        onSubmit: () => Effect.die("boom"),
        optimistic: () => log.push("opt"),
        rollback: () => log.push("rb"),
        singleFlight: { mode: "auto" },
      },
    );
    f.submit();
    await tick();
    expect(log).toEqual(["opt", "rb"]);
  });
});

describe("subscribe de-duplication (bug 7)", () => {
  it("Atom.subscribe only fires when the value changes", () => {
    const count = Atom.make(1);
    const parity = Atom.make((get) => get(count) % 2);
    const seen: number[] = [];
    const stop = Atom.subscribe(parity, (v) => seen.push(v));
    count.set(3);
    flush();
    count.set(5);
    flush();
    count.set(6);
    flush();
    stop();
    expect(seen).toEqual([1, 0]);
  });
});

describe("family prefix eviction (bug 8)", () => {
  it("evicting a prefix also drops descendant members", () => {
    const fam = Atom.family((...a: string[]) => a.join("/"));
    fam("a");
    fam("a", "b");
    fam("c");
    fam.evict("a");
    expect(fam.size).toBe(1);
    expect(fam.keys()).toEqual([["c"]]);
  });

  it("capacity eviction of a prefix also drops descendant members", () => {
    const fam = Atom.family((...a: string[]) => a.join("/"), { capacity: 2 });
    fam("a");
    fam("a", "b");
    fam("c");
    // "a" is evicted by capacity; its trie children go with it.
    expect(fam.keys()).toEqual([["c"]]);
  });
});

describe("AtomRef granular subscriptions (bug 9)", () => {
  it("writing one property does not notify a sibling property subscriber", () => {
    const todo = AtomRef.make({ title: "a", done: false });
    const seen: string[] = [];
    const stop = todo.prop("title").subscribe((t) => seen.push(t));
    todo.prop("done").set(true);
    flush();
    stop();
    expect(seen).toEqual(["a"]);
  });

  it("prop refs read the new value synchronously after a write", () => {
    const todo = AtomRef.make({ title: "a", done: false });
    const title = todo.prop("title");
    title.set("b");
    expect(title()).toBe("b");
  });
});
