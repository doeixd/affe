import { describe, expect, it } from "vitest";
import { Effect, Exit, Scope } from "effect";
import * as Element from "../Element.js";
import * as Behaviors from "../behaviors.js";
import { createSignal, flush } from "../api.js";

describe("element audit fixes", () => {
  it("F: collection per-item observer resources are released when the item is removed", () => {
    const a = Element.interactive();
    const b = Element.interactive();
    const items = Element.collection<Element.Interactive>([a]);
    const data = ["x"];
    const scope = Effect.runSync(Scope.make());
    const bind: any = Effect.runSync(
      Behaviors.selection<string>()
        .run({ items, getItem: (i: number) => data[i] } as any, {} as any)
        .pipe(Scope.provide(scope)) as any,
    );
    items.set([b]);
    bind.toggle("x");
    flush();
    expect(b.getAttr("aria-selected")).toBe(true);
    expect(a.getAttr("aria-selected")).toBe(false);
    Effect.runSync(Scope.close(scope, Exit.void));
  });

  it("F: per-item reactions and listeners do not pile up across set() and die with the parent scope", () => {
    const item = Element.interactive();
    const items = Element.collection<Element.Interactive>([item]);
    const [count, setCount] = createSignal(0);
    let runs = 0;
    let presses = 0;
    const scope = Effect.runSync(Scope.make());
    Effect.runSync(
      items.observeEach((el) =>
        Effect.gen(function* () {
          yield* el.setAttr("data-count", () => {
            runs += 1;
            return count();
          });
          yield* el.on("press", () => {
            presses += 1;
          });
        })).pipe(Scope.provide(scope)),
    );
    items.set([item]);
    items.set([item]);
    runs = 0;
    setCount(1);
    flush();
    expect(runs).toBe(1);
    item.emit("press");
    expect(presses).toBe(1);

    Effect.runSync(Scope.close(scope, Exit.void));
    runs = 0;
    setCount(2);
    flush();
    expect(runs).toBe(0);
    item.emit("press");
    expect(presses).toBe(1);
  });
});
