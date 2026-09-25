/**
 * A component instance owns a child of the ambient component scope, so the
 * resources its setup acquires are released when that instance is disposed
 * (a conditional flips, a route stops matching) — not when the whole mount
 * closes, which is what happened before.
 */
import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import * as Component from "../Component.js";
import { createMemo, createRoot, createSignal, flush } from "../api.js";
import { WithLayer } from "../effect-ts.js";

const resolve = (value: unknown): unknown => {
  let current = value;
  while (typeof current === "function") current = (current as () => unknown)();
  return current;
};

describe("component instance scope", () => {
  it("releases an instance's resources when the instance is disposed", async () => {
    const log: Array<string> = [];
    const Probe = Component.make(
      Component.props<{ readonly name: string }>(),
      Component.require<never>(),
      (props) => Effect.acquireRelease(
        Effect.sync(() => { log.push(`acquire ${props.name}`); return {}; }),
        () => Effect.sync(() => { log.push(`release ${props.name}`); }),
      ),
      (props) => props.name,
    );
    const [show, setShow] = createSignal(true);
    const { view, dispose } = createRoot((dispose) => ({
      dispose,
      view: (WithLayer({
        layer: Layer.empty,
        children: () => [Probe({ name: "stays" }), createMemo(() => (show() ? Probe({ name: "toggled" }) : null))],
      }) as () => ReadonlyArray<unknown>)(),
    }));
    expect(view.map(resolve)).toEqual(["stays", "toggled"]);
    setShow(false);
    flush();
    await Promise.resolve();
    expect(log).toEqual(["acquire stays", "acquire toggled", "release toggled"]);
    dispose();
    await Promise.resolve();
    expect(log).toContain("release stays");
  });
});
