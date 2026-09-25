/**
 * DQ-073: slot handles bind to the elements they name through
 * `View.Slot.ref(...)`, so slot-attached styles and behaviors reach the
 * rendered page (client DOM and SSR output). End to end with compiled JSX.
 */
import { transformSync } from "@babel/core";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as runtime from "../runtime.js";
import { createRoot, createSignal, flush } from "../api.js";
import * as Behavior from "../Behavior.js";
import * as Component from "../Component.js";
import * as Element from "../Element.js";
import * as Style from "../Style.js";
import * as View from "../View.js";
import { createComponent, createServerDocument, render, renderToString } from "../dom.js";

// ── Compile-and-run harness (same pattern as dom-audit-fixes.test.ts) ────────

function compileExecutable<Module>(source: string, scope: Record<string, unknown>): Module {
  const result = transformSync(source, {
    filename: "slot-binding.tsx",
    configFile: "./babel.config.json",
  });
  if (result?.code == null) throw new Error("Expected Babel output.");
  const imports: Array<{ readonly imported: string; readonly local: string }> = [];
  const withoutImports = result.code.replace(
    /import\s*\{\s*([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)\s*\}\s*from\s*"@doeixd\/affe\/runtime";?/g,
    (_statement, imported: string, local: string) => {
      imports.push({ imported, local });
      return "";
    },
  );
  const body = withoutImports.replace(/\bexport\s+default\s+/, "return ");
  const bindings = imports
    .map(({ imported, local }) => `const ${local} = __runtime.${imported};`)
    .join("\n");
  const names = Object.keys(scope);
  return Function("__runtime", ...names, `"use strict";\n${bindings}\n${body}`)(
    runtime,
    ...names.map((name) => scope[name]),
  ) as Module;
}

// ── A client document with real event dispatch ───────────────────────────────
// The server document is the repo's DOM-free document; its elements ignore
// listeners on purpose. For the client-path tests we give its element
// prototype a minimal EventTarget (add/remove/dispatch) and focus/blur, and
// count live listeners so disposal can be asserted.

type Carrier = Record<string, unknown>;
const carrier = globalThis as unknown as Carrier;

interface TestElement {
  readonly style: { cssText: string; getPropertyValue?(name: string): string };
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  dispatchEvent(event: { readonly type: string } & Record<string, unknown>): void;
  querySelector?(selector: string): TestElement | null;
  readonly childNodes: ReadonlyArray<unknown>;
  readonly nodeName: string;
  toHTML(): string;
}

const listenerRegistry = new WeakMap<object, Map<string, Set<(event: unknown) => void>>>();
let liveListeners = 0;

function installClientDocument(): () => void {
  const hadDocument = "document" in carrier;
  const hadNode = "Node" in carrier;
  const previousDocument = carrier.document;
  const previousNode = carrier.Node;
  const doc = createServerDocument() as { createElement(tag: string): object };
  const element = doc.createElement("div");
  const proto = Object.getPrototypeOf(element) as Record<string, unknown>;
  const saved = {
    addEventListener: proto.addEventListener,
    removeEventListener: proto.removeEventListener,
  };
  proto.addEventListener = function (this: object, name: string, listener: (event: unknown) => void) {
    const byName = listenerRegistry.get(this) ?? new Map();
    listenerRegistry.set(this, byName);
    const set = byName.get(name) ?? new Set();
    byName.set(name, set);
    if (!set.has(listener)) liveListeners += 1;
    set.add(listener);
  };
  proto.removeEventListener = function (this: object, name: string, listener: (event: unknown) => void) {
    const set = listenerRegistry.get(this)?.get(name);
    if (set?.delete(listener) === true) liveListeners -= 1;
  };
  proto.dispatchEvent = function (this: object, event: { readonly type: string }) {
    for (const listener of [...(listenerRegistry.get(this)?.get(event.type) ?? [])]) {
      listener(event);
    }
    return true;
  };
  // Compiled JSX clones `<template>` content; the server element parses
  // `innerHTML` into its own children, so the template is its own content.
  Object.defineProperty(proto, "content", {
    configurable: true,
    get(this: { nodeName: string }) {
      return this.nodeName.toLowerCase() === "template" ? this : undefined;
    },
  });
  proto.focus = function (this: { dispatchEvent(event: unknown): void }) {
    this.dispatchEvent({ type: "focus" });
  };
  proto.blur = function (this: { dispatchEvent(event: unknown): void }) {
    this.dispatchEvent({ type: "blur" });
  };
  carrier.document = doc;
  carrier.Node = Object.getPrototypeOf(Object.getPrototypeOf(element)).constructor;
  return () => {
    proto.addEventListener = saved.addEventListener;
    proto.removeEventListener = saved.removeEventListener;
    delete proto.dispatchEvent;
    delete proto.focus;
    delete proto.content;
    delete proto.blur;
    if (hadDocument) carrier.document = previousDocument;
    else delete carrier.document;
    if (hadNode) carrier.Node = previousNode;
    else delete carrier.Node;
  };
}

function find(root: unknown, slot: string): TestElement {
  const visit = (node: unknown): TestElement | undefined => {
    const el = node as TestElement;
    if (typeof el?.getAttribute === "function" && el.getAttribute(Element.SLOT_ATTRIBUTE) === slot) return el;
    for (const child of el?.childNodes ?? []) {
      const found = visit(child);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const found = visit(root);
  if (found === undefined) throw new Error(`no element bound to slot "${slot}"`);
  return found;
}

/** Component setup runs in a fiber; let it commit, then flush the render. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  flush();
}

function styleOf(el: TestElement): string {
  return el.style.cssText;
}

// ── The component under test ─────────────────────────────────────────────────

const FieldSlots = View.Slots.define({
  root: { capability: Element.Capability.Container },
  input: {
    capability: Element.Capability.TextInput,
    allowedEvents: [View.Event.Input, View.Event.Focus, View.Event.Press, View.Event.Click],
  },
});

const fieldView = compileExecutable<(props: unknown, bindings: unknown) => unknown>(
  `export default (_props, _bindings) =>
    View.fromSlots(FieldSlots, (
      <label ref={View.Slot.ref(FieldSlots, "root")}>
        <span>Name</span>
        <input ref={View.Slot.ref(FieldSlots, "input")} />
      </label>
    ))`,
  { View, FieldSlots },
);

function makeField(log: Array<string>, options?: { readonly isOpen?: () => boolean }) {
  const FieldStyle = Style.make(FieldSlots, {
    root: Style.slot({ backgroundColor: "red", padding: 16, opacity: 0.5 }),
    input: Style.compose(
      Style.slot({ marginTop: 4 }),
      Style.whenBinding("isOpen", true, Style.slot({ borderWidth: 2 })),
    ),
  });
  const FieldBehavior = Behavior.forSlots(FieldSlots)((elements) =>
    Effect.gen(function* () {
      yield* elements.input.setAttr("aria-label", "Name");
      yield* elements.input.setAttr("data-open", () => (options?.isOpen?.() === true ? "yes" : null));
      yield* elements.input.on("click", () => {
        log.push("click");
      });
      yield* elements.input.on("press", () => {
        log.push("press");
      });
      yield* elements.input.on("focus", () => {
        log.push("focus");
      });
      return { focus: () => elements.input.focus() };
    })
  );
  const isOpen = options?.isOpen ?? (() => false);
  return Component.make(
    Component.props<{}>(),
    Component.require<never>(),
    () => Effect.succeed({ isOpen }),
    fieldView as never,
  ).pipe(
    Component.withSlots(FieldSlots),
    Style.attachToSlots(FieldStyle, FieldSlots),
    Behavior.attachToSlots(FieldBehavior, FieldSlots),
  );
}

describe("slot binding: client (DQ-073)", () => {
  let restore: () => void = () => {};
  beforeEach(() => {
    restore = installClientDocument();
    liveListeners = 0;
  });
  afterEach(() => restore());

  it("styles, attributes, listeners and focus reach the rendered element", async () => {
    const log: Array<string> = [];
    const Field = makeField(log);
    const container = (carrier.document as { createElement(tag: string): Element }).createElement("div");
    const dispose = render(() => createComponent(Field as never, {}), container);
    await settle();

    const root = find(container, "root");
    const input = find(container, "input");
    expect(root.nodeName.toLowerCase()).toBe("label");
    expect(input.nodeName.toLowerCase()).toBe("input");

    // Styles: resolved values, numeric lengths in px, unitless stays unitless.
    expect(styleOf(root)).toContain("background-color: red");
    expect(styleOf(root)).toContain("padding: 16px");
    expect(styleOf(root)).toContain("opacity: 0.5");
    expect(styleOf(input)).toContain("margin-top: 4px");

    // Attributes set by the behavior, through the attribute contract.
    expect(input.getAttribute("aria-label")).toBe("Name");
    expect(input.hasAttribute("data-open")).toBe(false);

    // A real DOM click reaches the behavior (both `click` and `press`).
    input.dispatchEvent({ type: "click" });
    expect(log).toEqual(["click", "press"]);

    // Enter on a non-natively-activating element triggers press.
    log.length = 0;
    root.dispatchEvent({ type: "keydown", key: "Enter" });
    input.dispatchEvent({ type: "keydown", key: "Enter" });
    // <input> activates natively (Enter submits / click follows), so the
    // binding does not synthesize a second press from keydown.
    expect(log).toEqual([]);

    // A real focus event reaches the behavior's focus listener.
    input.dispatchEvent({ type: "focus" });
    expect(log).toEqual(["focus"]);

    expect(liveListeners).toBeGreaterThan(0);
    dispose();
    flush();
    expect(liveListeners).toBe(0);
    log.length = 0;
    input.dispatchEvent({ type: "click" });
    expect(log).toEqual([]);
  });

  it("maps press to Enter/Space keydown on elements without native activation", async () => {
    const Slots = View.Slots.define({ trigger: { capability: Element.Capability.Interactive } });
    const view = compileExecutable<(p: unknown, b: unknown) => unknown>(
      `export default () => View.fromSlots(Slots, <div role="button" tabindex="0" ref={View.Slot.ref(Slots, "trigger")}>go</div>)`,
      { View, Slots },
    );
    const presses: Array<unknown> = [];
    const Trigger = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({}),
      view as never,
    ).pipe(
      Component.withSlots(Slots),
      Behavior.attachToSlots(
        Behavior.forSlots(Slots)((elements) =>
          Effect.gen(function* () {
            yield* elements.trigger.on("press", (event) => presses.push((event as { type: string }).type));
            return {};
          })
        ),
        Slots,
      ),
    );
    const container = (carrier.document as { createElement(tag: string): Element }).createElement("div");
    const dispose = render(() => createComponent(Trigger as never, {}), container);
    await settle();
    const trigger = find(container, "trigger");
    trigger.dispatchEvent({ type: "keydown", key: "Enter" });
    trigger.dispatchEvent({ type: "keydown", key: " ", preventDefault: () => {} });
    trigger.dispatchEvent({ type: "keydown", key: "a" });
    trigger.dispatchEvent({ type: "keydown", key: "Enter", repeat: true });
    trigger.dispatchEvent({ type: "click" });
    expect(presses).toEqual(["keydown", "keydown", "click"]);
    dispose();
    expect(liveListeners).toBe(0);
  });

  it("focus() on a bound focusable handle calls the element's focus", async () => {
    const handle = Element.focusable();
    const log: Array<string> = [];
    Effect.runSync(Effect.scoped(Effect.gen(function* () {
      yield* handle.on("focus", () => log.push("focus"));
      const doc = carrier.document as { createElement(tag: string): Element.BindableElement & TestElement };
      const el = doc.createElement("button");
      let focused = 0;
      const originalFocus = (el as unknown as { focus: () => void }).focus;
      (el as unknown as { focus: () => void }).focus = function (this: unknown) {
        focused += 1;
        originalFocus.call(this);
      };
      const unbind = Element.bindElement(handle, el, "trigger");
      handle.focus();
      expect(focused).toBe(1);
      expect(log).toEqual(["focus"]);
      unbind();
      handle.focus(); // unbound: in-memory emit
      expect(focused).toBe(1);
      expect(log).toEqual(["focus", "focus"]);
    })));
  });

  it("reactive style and attribute changes write through to the element", async () => {
    const [isOpen, setIsOpen] = createSignal(false);
    const Field = makeField([], { isOpen });
    const container = (carrier.document as { createElement(tag: string): Element }).createElement("div");
    const dispose = render(() => createComponent(Field as never, {}), container);
    await settle();
    const input = find(container, "input");
    expect(styleOf(input)).not.toContain("border-width");
    expect(input.hasAttribute("data-open")).toBe(false);

    setIsOpen(true);
    flush();
    // Same element: a binding change updates it in place, no re-render.
    expect(find(container, "input")).toBe(input);
    expect(styleOf(input)).toContain("border-width: 2px");
    expect(input.getAttribute("data-open")).toBe("yes");

    setIsOpen(false);
    flush();
    expect(styleOf(input)).not.toContain("border-width");
    expect(input.hasAttribute("data-open")).toBe(false);
    dispose();
  });

  it("two instances bind independent elements and handles", async () => {
    const log: Array<string> = [];
    const Field = makeField(log);
    const doc = carrier.document as { createElement(tag: string): Element };
    const a = doc.createElement("div");
    const b = doc.createElement("div");
    const disposeA = render(() => createComponent(Field as never, {}), a);
    const disposeB = render(() => createComponent(Field as never, {}), b);
    await settle();
    const inputA = find(a, "input");
    const inputB = find(b, "input");
    expect(inputA).not.toBe(inputB);
    expect(styleOf(inputA)).toContain("margin-top: 4px");
    expect(styleOf(inputB)).toContain("margin-top: 4px");

    inputA.dispatchEvent({ type: "click" });
    expect(log).toEqual(["click", "press"]);

    disposeA();
    log.length = 0;
    inputA.dispatchEvent({ type: "click" });
    expect(log).toEqual([]);
    inputB.dispatchEvent({ type: "click" });
    expect(log).toEqual(["click", "press"]);
    disposeB();
    expect(liveListeners).toBe(0);
  });

  it("binds inside lazily rendered children to the component instance", async () => {
    const Slots = View.Slots.define({ panel: { capability: Element.Capability.Container } });
    const [shown, setShown] = createSignal(false);
    const view = compileExecutable<(p: unknown, b: unknown) => unknown>(
      `export default () => View.fromSlots(Slots, <div>{shown() ? <section ref={View.Slot.ref(Slots, "panel")}>x</section> : null}</div>)`,
      { View, Slots, shown },
    );
    const Panel = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({}),
      view as never,
    ).pipe(
      Component.withSlots(Slots),
      Style.attachToSlots(Style.make(Slots, { panel: Style.slot({ gap: 8 }) }), Slots),
    );
    const container = (carrier.document as { createElement(tag: string): Element }).createElement("div");
    const dispose = render(() => createComponent(Panel as never, {}), container);
    await settle();
    setShown(true);
    flush();
    const panel = find(container, "panel");
    expect(styleOf(panel)).toContain("gap: 8px");
    // The define-time handle was never touched: the instance handle bound.
    expect(Element.boundElementOf(View.Slots.handles(Slots).panel)).toBeUndefined();
    dispose();
  });

  it("the resume activation render path (renderWithBindings) binds the restored instance's handles", async () => {
    // Resume activation re-renders a restored component into its region with
    // `Component.renderWithBindings(component, props, restoredBindings)`; the
    // refs re-run there and bind the fresh elements to the restored handles.
    const log: Array<string> = [];
    const Field = makeField(log);
    const bindings = Effect.runSync(Effect.scoped(Component.setupEffect(Field, {}))) as unknown as {
      readonly slots: { readonly input: Element.TextInput };
    };
    let node: unknown;
    const dispose = createRoot((disposeRoot) => {
      node = Component.renderWithBindings(Field, {}, bindings as never);
      return disposeRoot;
    });
    const input = find(node, "input");
    expect(Element.boundElementOf(bindings.slots.input)).toBe(input);
    expect(styleOf(input)).toContain("margin-top: 4px");
    dispose();
    expect(Element.boundElementOf(bindings.slots.input)).toBeUndefined();
  });

  it("a collection slot binds one item handle per rendered element", async () => {
    const Slots = View.Slots.define({ items: { capability: Element.Capability.Collection } });
    const [labels, setLabels] = createSignal(["a", "b"]);
    const view = compileExecutable<(p: unknown, b: unknown) => unknown>(
      `export default () => View.fromSlots(Slots, <ul>{labels().map((label) => <li ref={View.Slot.ref(Slots, "items")}>{label}</li>)}</ul>)`,
      { View, Slots, labels },
    );
    let itemCount = 0;
    const List = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({}),
      view as never,
    ).pipe(
      Component.withSlots(Slots),
      Behavior.attachToSlots(
        Behavior.forSlots(Slots)((elements) =>
          elements.items.observeEach((item, index) =>
            Effect.sync(() => {
              itemCount = Math.max(itemCount, index + 1);
            }).pipe(Effect.andThen(item.setAttr("data-index", index)))
          ).pipe(Effect.as({}))
        ),
        Slots,
      ),
    );
    const container = (carrier.document as { createElement(tag: string): Element }).createElement("div");
    const dispose = render(() => createComponent(List as never, {}), container);
    await settle();
    const html = (container as unknown as TestElement).toHTML();
    expect(html).toContain(`<li data-af-slot="items" data-index="0">a</li>`);
    expect(html).toContain(`<li data-af-slot="items" data-index="1">b</li>`);
    setLabels(["a", "b", "c"]);
    flush();
    expect((container as unknown as TestElement).toHTML()).toContain(`data-index="2">c</li>`);
    expect(itemCount).toBe(3);
    dispose();
  });
});

describe("element-backed handle writes", () => {
  it("expands structured style values and skips selector meta keys", () => {
    const doc = createServerDocument() as unknown as { createElement(tag: string): Element.BindableElement & TestElement };
    const el = doc.createElement("div");
    const handle = Element.container();
    Effect.runSync(Effect.gen(function* () {
      yield* handle.setStyleOnce("shadow", { x: 0, y: 2, blur: 8, color: "rgba(0,0,0,.2)" });
      yield* handle.setStyleOnce("border", { width: 1, color: "#ddd" });
      yield* handle.setStyleOnce("padding", [4, 8]);
      yield* handle.setStyleOnce("--af-gap", "4px");
      yield* handle.setStyleOnce("_states", { open: { opacity: 1 } });
      yield* handle.setStyleOnce("__nest", { "& > p": { margin: 0 } });
    }));
    const unbind = Element.bindElement(handle, el, "root");
    const css = el.style.cssText;
    expect(css).toContain("box-shadow: 0 2px 8px rgba(0,0,0,.2)");
    expect(css).toContain("border: 1px solid #ddd");
    expect(css).toContain("padding: 4px 8px");
    expect(css).toContain("--af-gap: 4px");
    expect(css).not.toContain("_states");
    expect(css).not.toContain("nest");
    expect(el.getAttribute("data-af-slot")).toBe("root");

    // Unbound: writes stay in memory only; the element keeps its last state.
    unbind();
    Effect.runSync(handle.setStyleOnce("opacity", 0.5));
    expect(el.style.cssText).not.toContain("opacity");
    expect(handle.getStyle("opacity")).toBe(0.5);

    // Rebinding (a re-render) replays the full in-memory state.
    const next = doc.createElement("div");
    Element.bindElement(handle, next, "root");
    expect(next.style.cssText).toContain("opacity: 0.5");
    expect(next.style.cssText).toContain("box-shadow: 0 2px 8px rgba(0,0,0,.2)");
  });
});

describe("slot binding: SSR (DQ-073)", () => {
  it("renderToString serializes inline styles, attributes and data-af-slot", async () => {
    const Field = makeField([]);
    const html = renderToString(() => createComponent(Field as never, {}));
    expect(html).toContain(`data-af-slot="root"`);
    expect(html).toContain(`data-af-slot="input"`);
    expect(html).toMatch(/<label[^>]*style="[^"]*background-color: red[^"]*"/);
    expect(html).toMatch(/<label[^>]*style="[^"]*padding: 16px/);
    expect(html).toMatch(/<input[^>]*aria-label="Name"/);
    expect(html).toMatch(/<input[^>]*style="margin-top: 4px"/);
  });
});

describe("Style.extractStatic default selector", () => {
  it("targets the bound slot attribute", async () => {
    const { css } = Style.extractStatic(
      Style.make(FieldSlots, { root: Style.slot({ display: "grid" }) }),
    );
    expect(css).toContain(`[data-af-slot="root"] { display: grid; }`);
  });
});
