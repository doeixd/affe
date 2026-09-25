/**
 * `Route.Switch` renders the most specific matching routed child.
 *
 * Before the fix it returned its first non-null child — and a component call
 * is never null — so only the first route of every example ever rendered.
 * `WithLayer` (which every router example wraps the app in) also never
 * rendered its children, because `Layer.launch` never completes, and did not
 * hand the layer's services to them.
 */
import { describe, expect, it } from "vitest";
import { Context, Effect, Layer, Schema } from "effect";
import * as Component from "../Component.js";
import * as Route from "../Route.js";
import { createRoot, flush } from "../api.js";
import { renderToString } from "../dom.js";
import { WithLayer, useService } from "../effect-ts.js";
import { clearLoaderCache } from "../router-runtime.js";

const resolve = (value: unknown): unknown => {
  let current = value;
  while (typeof current === "function") current = (current as () => unknown)();
  return current;
};

function routes() {
  const Home = Component.from<{}>(() => "home").pipe(Component.route("/", { exact: true }));
  const NewUser = Component.from<{}>(() => "new-user").pipe(Component.route("/users/new"));
  const User = Component.from<{}>(() => "user").pipe(
    Component.route("/users/:id", { params: Schema.Struct({ id: Schema.String }) }),
  );
  const Files = Component.from<{}>(() => "files").pipe(Component.route("/files/*"));
  return { Home, NewUser, User, Files };
}

describe("Route.Switch", () => {
  it("renders the most specific matching route, whatever the child order", () => {
    const { Home, NewUser, User, Files } = routes();
    const at = (path: string, children: ReadonlyArray<unknown>) =>
      renderToString(() => WithLayer({
        layer: Route.Router.Memory(path),
        children: () => Route.Switch({ children, fallback: "none" }),
      }));
    for (const children of [[Home, User, NewUser, Files], [Files, NewUser, User, Home]]) {
      expect(at("/", children)).toBe("home");
      expect(at("/users/new", children)).toBe("new-user");
      expect(at("/users/42", children)).toBe("user");
      expect(at("/files/a/b", children)).toBe("files");
      expect(at("/nowhere", children)).toBe("none");
    }
  });

  it("accepts already-called components", () => {
    const { Home, NewUser, User } = routes();
    const html = renderToString(() => WithLayer({
      layer: Route.Router.Memory("/users/new"),
      children: () => Route.Switch({ children: [Home({}), User({}), NewUser({})] }),
    }));
    expect(html).toBe("new-user");
  });

  it("accepts route-tree components from Route.componentOf", () => {
    const Home = Route.page("/", Component.from<{}>(() => "tree-home"));
    const About = Route.page("/about", Component.from<{}>(() => "tree-about"));
    const html = (path: string) => renderToString(() => WithLayer({
      layer: Route.Router.Memory(path),
      children: () => Route.Switch({ children: [Route.componentOf(Home)({}), Route.componentOf(About)({})], fallback: "none" }),
    }));
    expect(html("/about")).toBe("tree-about");
  });

  it("follows client-side navigation and keeps the instance across same-route URLs", () => {
    const { Home, NewUser, User } = routes();
    let router!: Route.RouterService;
    let instances = 0;
    const Counted = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.sync(() => { instances += 1; return {}; }),
      () => "user",
    ).pipe(Component.route("/users/:id"));
    // Evaluate the boundary once, as the DOM's insert would; the Switch it
    // returns is a memo that reacts to navigation on its own.
    const { view, dispose } = createRoot((dispose) => ({
      dispose,
      view: (WithLayer({
        layer: Route.Router.Memory("/"),
        children: () => {
          router = useService(Route.RouterTag);
          return Route.Switch({ children: [Home, NewUser, Counted, User], fallback: "none" });
        },
      }) as () => unknown)(),
    }));
    expect(resolve(view)).toBe("home");
    Effect.runSync(router.navigate("/users/new"));
    flush();
    expect(resolve(view)).toBe("new-user");
    Effect.runSync(router.navigate("/users/1"));
    flush();
    expect(resolve(view)).toBe("user");
    Effect.runSync(router.navigate("/users/2"));
    flush();
    expect(resolve(view)).toBe("user");
    expect(instances).toBe(1);
    Effect.runSync(router.navigate("/missing"));
    flush();
    expect(resolve(view)).toBe("none");
    dispose();
  });

  it("only runs the winning route's loader when given components", () => {
    clearLoaderCache();
    const ran: Array<string> = [];
    const loaded = (name: string, pattern: string) =>
      Route.loader(() => Effect.sync(() => { ran.push(name); return name; }))(
        Component.from<{}>(() => name).pipe(Component.route(pattern)),
      );
    const html = renderToString(() => WithLayer({
      layer: Route.Router.Memory("/users/new"),
      children: () => Route.Switch({ children: [loaded("by-id", "/users/:id"), loaded("new", "/users/new")] }),
    }));
    expect(html).toBe("new");
    expect(ran).toEqual(["new"]);
  });
});

describe("WithLayer", () => {
  const Greeting = Context.Service<{ readonly text: string }>("test/Greeting");

  it("renders its children once a synchronous layer is built, with the layer's services", () => {
    const Greet = Component.make(
      Component.props<{}>(),
      Component.require<typeof Greeting.Service>(),
      () => Effect.map(Effect.service(Greeting), (g) => ({ text: g.text })),
      (_props, bindings) => bindings.text,
    );
    const html = renderToString(() => WithLayer({
      layer: Layer.succeed(Greeting, { text: "hello" }),
      children: () => Greet({}),
    }));
    expect(html).toBe("hello");
  });

  it("makes its services visible to useService and to nested layers", () => {
    const Suffix = Context.Service<{ readonly text: string }>("test/Suffix");
    const SuffixLive = Layer.effect(Suffix, Effect.map(Effect.service(Greeting), (g) => ({ text: `${g.text}!` })));
    const html = renderToString(() => WithLayer({
      layer: Layer.succeed(Greeting, { text: "hi" }),
      children: () => WithLayer({
        layer: SuffixLive,
        children: () => `${useService(Greeting).text} ${useService(Suffix).text}`,
      }),
    }));
    expect(html).toBe("hi hi!");
  });

  it("shows the fallback until an asynchronous layer is ready, then its children", async () => {
    const Slow = Layer.effect(Greeting, Effect.as(Effect.sleep("5 millis"), { text: "late" }));
    const { view, dispose } = createRoot((dispose) => ({
      dispose,
      view: WithLayer({ layer: Slow, fallback: () => "loading", children: () => useService(Greeting).text }),
    }));
    expect(resolve(view)).toBe("loading");
    await new Promise((r) => setTimeout(r, 30));
    flush();
    expect(resolve(view)).toBe("late");
    dispose();
  });
});
