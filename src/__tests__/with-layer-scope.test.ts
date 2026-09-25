/**
 * `Component.withLayer` services reach the component and its descendants —
 * not the siblings rendered next to it.
 */
import { describe, expect, it } from "vitest";
import { Context, Effect, Layer } from "effect";
import * as Component from "../Component.js";
import { renderToString } from "../dom.js";

const Secret = Context.Service<{ readonly value: string }>("test/Secret");
const SecretLive = Layer.succeed(Secret, { value: "provided" });

const Probe = (label: string) => Component.make(
  Component.props<{}>(),
  Component.require<never>(),
  () => Effect.map(Effect.serviceOption(Secret), (found) => ({
    seen: found._tag === "Some" ? found.value.value : "none",
  })),
  (_props, b: { readonly seen: string }) => `[${label}:${b.seen}]`,
);

describe("Component.withLayer scope", () => {
  it("provides to the component and its children, not its siblings", () => {
    const Child = Probe("child");
    const Provider = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.map(Effect.service(Secret), (s) => ({ own: s.value })),
      (_props, b: { readonly own: string }) => [`[provider:${b.own}]`, Child({})],
    ).pipe(Component.withLayer(SecretLive));
    const Before = Probe("before");
    const After = Probe("after");
    const html = renderToString(() => [Before({}), Provider({}), After({})]);
    expect(html).toBe("[before:none][provider:provided][child:provided][after:none]");
  });
});
