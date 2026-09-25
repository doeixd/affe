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

describe("Component.route siblings outside a Switch", () => {
  const page = (name: string, pattern: string, log?: Array<string>) =>
    Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.acquireRelease(
        Effect.sync(() => { log?.push(`setup ${name}`); return {}; }),
        () => Effect.sync(() => { log?.push(`dispose ${name}`); }),
      ),
      () => `[${name}]`,
    ).pipe(Component.route(pattern));

  const mounted = (path: string, children: () => ReadonlyArray<unknown>) => {
    let router!: Route.RouterService;
    const { parts, dispose } = createRoot((dispose) => ({
      dispose,
      parts: (WithLayer({
        layer: Route.Router.Memory(path),
        children: () => {
          router = useService(Route.RouterTag);
          return children();
        },
      }) as () => ReadonlyArray<unknown>)(),
    }));
    const text = () => parts.map(resolve).filter((part) => part !== null).join("");
    const go = (to: string) => { Effect.runSync(router.navigate(to)); flush(); };
    return { text, go, dispose };
  };

  it("shows only the most specific of competing siblings", () => {
    const New = page("new", "/users/new");
    const User = page("user", "/users/:id");
    const view = mounted("/users/new", () => [User({}), New({})]);
    expect(view.text()).toBe("[new]");
    view.go("/users/7");
    expect(view.text()).toBe("[user]");
    view.dispose();
  });

  it("keeps a layout and its child together", () => {
    const Users = page("users", "/users");
    const User = page("user", "/users/:id");
    const view = mounted("/users/7", () => [Users({}), User({})]);
    expect(view.text()).toBe("[users][user]");
    view.go("/users");
    expect(view.text()).toBe("[users]");
    view.dispose();
  });

  it("renders a page mounted on a URL it does not match once navigation reaches it", () => {
    const About = page("about", "/about");
    const view = mounted("/", () => [About({})]);
    expect(view.text()).toBe("");
    view.go("/about");
    expect(view.text()).toBe("[about]");
    view.dispose();
  });

  it("switches between already-called components passed to Route.Switch", () => {
    const Home = page("home", "/", undefined);
    const About = page("about", "/about");
    const { view, go, dispose } = (() => {
      let router!: Route.RouterService;
      const { view, dispose } = createRoot((dispose) => ({
        dispose,
        view: (WithLayer({
          layer: Route.Router.Memory("/about"),
          children: () => {
            router = useService(Route.RouterTag);
            return Route.Switch({ children: [About({}), Home({})] });
          },
        }) as () => unknown)(),
      }));
      return { view, dispose, go: (to: string) => { Effect.runSync(router.navigate(to)); flush(); } };
    })();
    expect(resolve(view)).toBe("[about]");
    go("/");
    expect(resolve(view)).toBe("[home]");
    go("/about");
    expect(resolve(view)).toBe("[about]");
    dispose();
  });

  it("never sets up the losing sibling and disposes a page when it stops matching", () => {
    const log: Array<string> = [];
    const New = page("new", "/users/new", log);
    const User = page("user", "/users/:id", log);
    const view = mounted("/users/new", () => [User({}), New({})]);
    expect(view.text()).toBe("[new]");
    expect(log).toEqual(["setup new"]);
    view.go("/users/7");
    expect(view.text()).toBe("[user]");
    // Sibling gates update in registration order, so the new page may set up
    // before the old one's scope closes; both must happen, once each.
    expect([...log].sort()).toEqual(["dispose new", "setup new", "setup user"]);
    view.dispose();
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
