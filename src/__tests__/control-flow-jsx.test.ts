/**
 * Control-flow components as compiled JSX uses them: `createComponent`
 * calls the component once, untracked, with prop GETTERS (`when={x()}`
 * compiles to `get when() { return x(); }`). Before the fix each of these
 * read its props eagerly and rendered its first state forever.
 */
import { describe, expect, it } from "vitest";
import { Option } from "effect";
import { createRoot, createSignal, flush } from "../api.js";
import { createComponent } from "../dom.js";
import {
  Async,
  Errored,
  Loading,
  Match,
  MatchOption,
  MatchTag,
  Optional,
  Result,
  Show,
  Switch,
  TypedBoundary,
} from "../effect-ts.js";

const resolve = (value: unknown): unknown => {
  let current = value;
  while (typeof current === "function") current = (current as () => unknown)();
  return current;
};

/** Mount `build` in a root; `read()` resolves its current output. */
function mountView(build: () => unknown) {
  return createRoot((dispose) => {
    const view = build();
    return { read: () => resolve(view), dispose };
  });
}

describe("control flow in JSX follows its props", () => {
  it("Show", () => {
    const [on, setOn] = createSignal(false);
    const view = mountView(() => createComponent(Show, {
      get when() { return on(); },
      fallback: () => "off",
      children: "on",
    }));
    expect(view.read()).toBe("off");
    setOn(true); flush();
    expect(view.read()).toBe("on");
    view.dispose();
  });

  it("Async", () => {
    const [result, setResult] = createSignal<Result<number, string>>(Result.loading);
    const view = mountView(() => createComponent(Async<number, string>, {
      get result() { return result(); },
      loading: () => "loading",
      error: (e: string) => `error ${e}`,
      success: (n: number) => `value ${n}`,
    }));
    expect(view.read()).toBe("loading");
    setResult(Result.success(2)); flush();
    expect(view.read()).toBe("value 2");
    setResult(Result.failure("boom")); flush();
    expect(view.read()).toBe("error boom");
    view.dispose();
  });

  it("MatchTag, Errored and TypedBoundary", () => {
    const [result, setResult] = createSignal<Result<number, string>>(Result.success(1));
    const tag = mountView(() => createComponent(MatchTag<Result<number, string>, string>, {
      get value() { return result(); },
      cases: { Success: (r) => `ok ${r.value}`, Failure: (r) => `bad ${r.error}` },
      fallback: () => "other",
    }));
    const errored = mountView(() => createComponent(Errored<number, string>, {
      get result() { return result(); },
      fallback: () => "fine",
      children: (e) => `caught ${String(e)}`,
    }));
    const typed = mountView(() => createComponent(TypedBoundary<string>, {
      get result() { return result(); },
      catch: (e: unknown): e is string => typeof e === "string",
      fallback: () => "fine",
      children: (e: string) => `typed ${e}`,
    }));
    expect([tag.read(), errored.read(), typed.read()]).toEqual(["ok 1", "fine", "fine"]);
    setResult(Result.failure("x")); flush();
    expect([tag.read(), errored.read(), typed.read()]).toEqual(["bad x", "caught x", "typed x"]);
    tag.dispose(); errored.dispose(); typed.dispose();
  });

  it("Loading keeps its children mounted across non-loading changes", () => {
    const [result, setResult] = createSignal<Result<number, string>>(Result.loading);
    let builds = 0;
    const view = mountView(() => createComponent(Loading, {
      get when() { return result(); },
      fallback: () => "spinner",
      children: () => { builds += 1; return "content"; },
    }));
    expect(view.read()).toBe("spinner");
    setResult(Result.success(1)); flush();
    expect(view.read()).toBe("content");
    setResult(Result.success(2)); flush();
    expect(view.read()).toBe("content");
    expect(builds).toBe(1);
    view.dispose();
  });

  it("Switch / Match", () => {
    const [role, setRole] = createSignal<"admin" | "user" | "guest">("guest");
    const view = mountView(() => createComponent(Switch, {
      fallback: () => "guest",
      get children() {
        return [
          createComponent(Match, { get when() { return role() === "admin"; }, children: "admin" }),
          createComponent(Match, { get when() { return role() === "user"; }, children: "user" }),
        ];
      },
    }));
    expect(view.read()).toBe("guest");
    setRole("user"); flush();
    expect(view.read()).toBe("user");
    setRole("admin"); flush();
    expect(view.read()).toBe("admin");
    view.dispose();
  });

  it("Optional and MatchOption", () => {
    const [value, setValue] = createSignal<number | null>(null);
    const optional = mountView(() => createComponent(Optional<number>, {
      get when() { return value(); },
      fallback: () => "none",
      children: (n: number) => `n=${n}`,
    }));
    const option = mountView(() => createComponent(MatchOption<number>, {
      get value() { return Option.fromNullishOr(value()); },
      none: () => "none",
      some: (n: number) => `some ${n}`,
    }));
    expect([optional.read(), option.read()]).toEqual(["none", "none"]);
    setValue(0); flush();
    expect([optional.read(), option.read()]).toEqual(["n=0", "some 0"]);
    optional.dispose(); option.dispose();
  });
});
