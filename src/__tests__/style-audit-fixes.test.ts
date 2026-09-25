import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import * as Component from "../Component.js";
import * as Element from "../Element.js";
import * as Style from "../Style.js";
import * as StyleUtils from "../style-utils.js";
import { resolveTokenValue } from "../style-runtime.js";
import * as Theme from "../Theme.js";
import * as View from "../View.js";
import { foundationStylesheet } from "@doeixd/affe-css";

function styledRoot(style: Style.ComposedStyle<"root", never>) {
  const Root = View.Slot.make("root", { capability: Element.Capability.Container });
  const root = Element.container();
  const slots = View.Slots.make({ root: View.Slot.bind(Root, root) });
  const W = Component.make(
    Component.props<{}>(),
    Component.require<never>(),
    Component.setup<{}>().value("slots", () => ({ root })),
    () => View.fromSlots(slots, null),
  ).pipe(Style.attachToSlots(style as any, slots) as any) as any;
  return W;
}

describe("style audit fixes", () => {
  it("B: Theme.compose deep-merges nested token groups", () => {
    const composed = Theme.compose(
      Theme.define({ color: { text: { primary: "#111", secondary: "#333" } } }),
      Theme.define({ color: { text: { primary: "#000" } } }),
    );
    expect(composed.lookup("color.text.primary")).toBe("#000");
    expect(composed.lookup("color.text.secondary")).toBe("#333");
  });

  it("B: Theme.compose replaces structured shadow tokens whole", () => {
    const composed = Theme.compose(
      Theme.define({ shadow: { md: { x: 0, y: 4, blur: 8, spread: 2, color: "red" } } }),
      Theme.define({ shadow: { md: { x: 0, y: 1, blur: 2, color: "blue" } } }),
    );
    expect(composed.lookup("shadow.md")).toEqual({ x: 0, y: 1, blur: 2, color: "blue" });
  });

  it("C: attachToSlots resolves tokens through the provided Theme service", () => {
    const W = styledRoot(Style.make({ root: Style.slot({ padding: "md", color: "text.primary" }) }) as any);
    const bindings = Effect.runSync(
      Effect.scoped(Component.setupEffect(W, {})).pipe(
        Effect.provide(Theme.define({ spacing: { md: 4 } }).layer()),
      ) as any,
    );
    const view = Component.renderViewWithBindings(W, {}, bindings) as any;
    expect(view.slots.root.getStyle("padding")).toBe(4);
    // Tokens the partial theme does not override fall back to the defaults.
    expect(view.slots.root.getStyle("color")).toBe("#111827");
  });

  it("C: attachToSlots without a Theme service uses the default tokens", () => {
    const W = styledRoot(Style.make({ root: Style.slot({ padding: "md" }) }) as any);
    const bindings = Effect.runSync(Effect.scoped(Component.setupEffect(W, {})) as any);
    const view = Component.renderViewWithBindings(W, {}, bindings) as any;
    expect(view.slots.root.getStyle("padding")).toBe(16);
  });

  it("C: Style.attach (binding slots) resolves tokens through the Theme service", () => {
    const root = Element.container();
    const W = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().value("slots", () => ({ root })),
      () => null,
    ).pipe(Style.attach(Style.make({ root: Style.slot({ padding: "md" }) }) as any)) as any;
    Effect.runSync(
      Effect.scoped(Component.setupEffect(W, {})).pipe(
        Effect.provide(Theme.define({ spacing: { md: 4 } }).layer()),
      ) as any,
    );
    expect(root.getStyle("padding")).toBe(4);
  });

  it("D: object-valued shadow tokens resolve", () => {
    expect(resolveTokenValue("md", undefined, "shadow")).toEqual({
      x: 0,
      y: 4,
      blur: 8,
      color: "rgba(0,0,0,0.14)",
    });
  });

  it("D: structured values resolve each field under its own key", () => {
    expect(resolveTokenValue({ width: 1, color: "border" }, undefined, "border")).toEqual({
      width: 1,
      color: "#d7dde5",
    });
    expect(resolveTokenValue({ direction: "row", gap: "md" }, undefined, "flex")).toEqual({
      direction: "row",
      gap: 16,
    });
    expect(resolveTokenValue([8, "md"], undefined, "padding")).toEqual([8, 16]);
  });

  it("D: StyleUtils.elevated/bordered/flexRow resolve at runtime", () => {
    const W = styledRoot(
      Style.make({
        root: [StyleUtils.elevated("md"), StyleUtils.bordered(), StyleUtils.flexRow({ gap: "sm" })],
      }) as any,
    );
    const bindings = Effect.runSync(Effect.scoped(Component.setupEffect(W, {})) as any);
    const root = (Component.renderViewWithBindings(W, {}, bindings) as any).slots.root;
    expect(root.getStyle("shadow")).toEqual({ x: 0, y: 4, blur: 8, color: "rgba(0,0,0,0.14)" });
    expect(root.getStyle("border")).toEqual({ width: 1, color: "#d7dde5" });
    expect(root.getStyle("flex")).toMatchObject({ direction: "row", gap: 8 });
  });

  it("E: extractStatic emits px for numeric lengths, unitless where CSS requires", () => {
    const css = Style.extractStatic(
      Style.make({ root: Style.slot({ padding: 16, opacity: 0.5, zIndex: 2, fontWeight: 600, lineHeight: 1.5, margin: 0 } as any) }),
    ).css;
    expect(css).toContain("padding: 16px;");
    expect(css).toContain("opacity: 0.5;");
    expect(css).toContain("z-index: 2;");
    expect(css).toContain("font-weight: 600;");
    expect(css).toContain("line-height: 1.5;");
    expect(css).toContain("margin: 0;");
  });

  it("E: foundationStylesheet emits px for length-category tokens", () => {
    const sheet = foundationStylesheet();
    expect(sheet).toContain("--af-spacing-md: 16px;");
    expect(sheet).toContain("--af-radius-md: 8px;");
    expect(sheet).toContain("--af-fontSize-body-md: 16px;");
    expect(sheet).toContain("--af-fontWeight-bold: 700;");
    expect(sheet).toContain("--af-radius-none: 0;");
  });
});
