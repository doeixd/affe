/**
 * Regression coverage for the component runtime audit: component scopes
 * reaching later-created children, `Component.withLayer` lifetime and
 * propagation to descendants, and per-instance slot handles for mounted
 * components.
 */
import { Context, Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as runtime from "../runtime.js";
import { createEffect, createRoot, createSignal, flush } from "../api.js";
import * as Component from "../Component.js";
import * as Element from "../Element.js";
import * as View from "../View.js";
import { createServerDocument } from "../dom.js";
import { mount } from "../effect-ts.js";

type Carrier = Record<string, unknown>;
const carrier = globalThis as unknown as Carrier;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let restore: () => void = () => {};
beforeEach(() => {
  const hadDocument = "document" in carrier;
  const hadNode = "Node" in carrier;
  const previousDocument = carrier.document;
  const previousNode = carrier.Node;
  const doc = createServerDocument() as { createElement(tag: string): object };
  carrier.document = doc;
  carrier.Node = Object.getPrototypeOf(
    Object.getPrototypeOf(doc.createElement("div")),
  ).constructor;
  restore = () => {
    if (hadDocument) carrier.document = previousDocument;
    else delete carrier.document;
    if (hadNode) carrier.Node = previousNode;
    else delete carrier.Node;
  };
});
afterEach(() => restore());

function el(tag: string): Element {
  return (carrier.document as Document).createElement(tag);
}

function newContainer(): Element {
  return (carrier.document as Document).createElement("main");
}

function html(node: unknown): string {
  return (node as { toHTML(): string }).toHTML();
}

describe("component scope reaches later-created children (bug 4)", () => {
  it("gives a conditionally created child a scope and runs its finalizers", async () => {
    let acquired = 0;
    let released = 0;
    const Child = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () =>
        Effect.acquireRelease(
          Effect.sync(() => {
            acquired += 1;
          }),
          () =>
            Effect.sync(() => {
              released += 1;
            }),
        ).pipe(Effect.as({})),
      () => "child",
    );
    // Hand-built equivalent of `<div>{show() ? <i><C/></i> : null}</div>`
    // (the server document has no `<template>` content for compiled JSX).
    const view = (C: unknown, show: () => boolean) => {
      const box = el("div");
      runtime.insert(box, () => {
        if (!show()) return null;
        const i = el("i");
        runtime.insert(i, runtime.createComponent(C as never, {}));
        return i;
      });
      return box;
    };
    const [show, setShow] = createSignal(false);
    const container = newContainer();
    const dispose = mount(() => view(Child, show), container, Layer.empty);
    await tick();
    expect(html(container)).toBe("<main><div></div></main>");

    setShow(true);
    flush();
    await tick();
    expect(html(container)).toBe("<main><div><i>child</i></div></main>");
    expect(acquired).toBe(1);
    expect(released).toBe(0);

    dispose();
    await tick();
    expect(released).toBe(1);
  });
});

interface ResourceService {
  readonly open: () => boolean;
}
const Resource = Context.Service<ResourceService>("affe/test/AuditResource");

describe("Component.withLayer (bugs 5, 6)", () => {
  it("keeps scoped layer resources alive until the component unmounts", async () => {
    let released = 0;
    let isOpen = false;
    const ResourceLive = Layer.effect(
      Resource,
      Effect.acquireRelease(
        Effect.sync(() => {
          isOpen = true;
          return { open: () => isOpen };
        }),
        () =>
          Effect.sync(() => {
            isOpen = false;
            released += 1;
          }),
      ),
    );
    const Widget = Component.make(
      Component.props<{}>(),
      Component.require<ResourceService>(),
      () => Effect.gen(function* () { return { resource: yield* Resource }; }),
      (_props, { resource }) => (resource.open() ? "open" : "closed"),
    ).pipe(Component.withLayer(ResourceLive));

    const container = newContainer();
    const dispose = mount(() => runtime.createComponent(Widget as never, {}), container, Layer.empty);
    await tick();
    expect(html(container)).toBe("<main>open</main>");
    expect(released).toBe(0);
    expect(isOpen).toBe(true);

    dispose();
    await tick();
    expect(released).toBe(1);
    expect(isOpen).toBe(false);
  });

  it("provides a parent's layer services to child components", async () => {
    const Child = Component.make(
      Component.props<{}>(),
      Component.require<ResourceService>(),
      () => Effect.gen(function* () { return { resource: yield* Resource }; }),
      (_props, { resource }) => (resource.open() ? "child sees parent layer" : "no"),
    );
    const parentView = (C: unknown) => {
      const p = el("p");
      runtime.insert(p, runtime.createComponent(C as never, {}));
      return p;
    };
    const Parent = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({}),
      () => parentView(Child),
    ).pipe(Component.withLayer(Layer.succeed(Resource, { open: () => true })));

    const container = newContainer();
    const dispose = mount(() => runtime.createComponent(Parent as never, {}), container, Layer.empty);
    await tick();
    await tick();
    expect(html(container)).toBe("<main><p>child sees parent layer</p></main>");
    dispose();
  });
});

describe("mounted components render per-instance slot handles (bug 14)", () => {
  it("renders the view against the same handles as bindings.slots", async () => {
    const Anatomy = View.Slots.define({
      root: { capability: Element.Capability.Container },
    });
    const seen: Array<{ view: unknown; bindings: unknown }> = [];
    const Widget = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>(),
      () => View.fromSlots(Anatomy, null),
    ).pipe(
      Component.withSlots(Anatomy),
      Component.withViewTransform((r: any, _p: any, b: any) => {
        seen.push({ view: r.slots.root, bindings: b.slots.root });
        return r;
      }),
    ) as unknown as (props: {}) => () => unknown;

    const mountOne = () =>
      createRoot((dispose) => {
        const accessor = Widget({});
        createEffect(() => {
          accessor();
        });
        return dispose;
      });
    const disposeA = mountOne();
    const disposeB = mountOne();
    await tick();

    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[0]!.view).toBe(seen[0]!.bindings);
    expect(seen[1]!.view).toBe(seen[1]!.bindings);
    expect(seen[0]!.view).not.toBe(seen[1]!.view);
    disposeA();
    disposeB();
  });
});
