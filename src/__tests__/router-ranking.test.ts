/**
 * Regressions for route specificity ranking and adjacent wire/cache fixes.
 * Each test failed on the code before its fix.
 */
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { Result as CoreResult } from "../effect-ts.js";
import type { Result as CoreResultType } from "../effect-ts.js";
import * as Component from "../Component.js";
import * as Route from "../Route.js";
import * as RouterRuntime from "../RouterRuntime.js";
import * as ServerRoute from "../ServerRoute.js";
import * as Serialization from "../Serialization.js";
import { canonicalCacheParameters } from "../cache-identity.js";
import { clearLoaderCache, durationToMillis } from "../router-runtime.js";
import { comparePatternSpecificity, selectMostSpecificBranch } from "../route-pattern.js";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function usersApp(prefix: string, order: "static-first" | "dynamic-first") {
  const calls: Array<string> = [];
  const New = Route.loader((_: {}) => Effect.sync(() => {
    calls.push("new");
    return "new";
  }))(Route.id(`${prefix}.new`)(Route.path(`/${prefix}/new`)(Component.from(() => null))));
  const Detail = Route.loader((params: { readonly id: string }) => Effect.sync(() => {
    calls.push(`id:${params.id}`);
    return params.id;
  }))(Route.id(`${prefix}.detail`)(Route.path(`/${prefix}/:id`)(Component.from(() => null))));
  const children = order === "static-first" ? [New, Detail] : [Detail, New];
  const App = Route.children(children)(
    Route.layout()(Route.path("/")(Component.from(() => null))),
  );
  return { App, calls };
}

const run = (app: Parameters<typeof Route.runMatchedLoaders>[0], path: string) =>
  Effect.runSync(Route.runMatchedLoaders(app, new URL(`http://test.local${path}`)));

describe("route specificity ranking", () => {
  it("ranks static > :param > :param? > * segment by segment", () => {
    const sorted = ["/a/*", "/a/:b?", "/a/:b", "/a/b"].sort(comparePatternSpecificity);
    expect(sorted).toEqual(["/a/b", "/a/:b", "/a/:b?", "/a/*"]);
    expect(comparePatternSpecificity("/a/:x/c", "/a/:y/d")).toBe(0);
  });

  for (const order of ["static-first", "dynamic-first"] as const) {
    it(`does not run the :id loader for /users/new (${order})`, () => {
      clearLoaderCache();
      const { App, calls } = usersApp(`rank-${order}`, order);
      const results = run(App, `/rank-${order}/new`);
      expect(calls).toEqual(["new"]);
      expect(results.map((item) => item.routeId)).toEqual([`rank-${order}.new`]);
    });

    it(`still runs the :id loader for /users/42 (${order})`, () => {
      clearLoaderCache();
      const { App, calls } = usersApp(`rank42-${order}`, order);
      run(App, `/rank42-${order}/42`);
      expect(calls).toEqual(["id:42"]);
    });
  }

  it("prefers :param over :param? over *", () => {
    clearLoaderCache();
    const calls: Array<string> = [];
    const mk = (id: string, pattern: string) =>
      Route.loader((_: {}) => Effect.sync(() => {
        calls.push(id);
        return id;
      }))(Route.id(id)(Route.path(pattern)(Component.from(() => null))));
    const Splat = mk("splat", "/rk-files/*");
    const Optional = mk("optional", "/rk-files/:name?");
    const Param = mk("param", "/rk-files/:name");
    const App = Route.children([Splat, Optional, Param])(
      Route.layout()(Route.path("/")(Component.from(() => null))),
    );
    run(App, "/rk-files/readme");
    expect(calls).toEqual(["param"]);

    calls.length = 0;
    const App2 = Route.children([mk("splat2", "/rk-docs/*"), mk("optional2", "/rk-docs/:name?")])(
      Route.layout()(Route.path("/")(Component.from(() => null))),
    );
    run(App2, "/rk-docs/intro");
    expect(calls).toEqual(["optional2"]);

    // A splat that consumes the rest beats a param that only prefix-matches.
    calls.length = 0;
    run(App2, "/rk-docs/a/b");
    expect(calls).toEqual(["splat2"]);
  });

  it("keeps the layout chain and index route of the winning branch", () => {
    const kept = selectMostSpecificBranch(
      ["/", "/u", "/u", "/u/:id", "/u/new", "/u/:id/edit"],
      (pattern) => pattern,
      "/u/new",
    );
    expect(kept).toEqual(["/", "/u", "/u", "/u/new"]);
  });

  it("client runtime navigation matches and loads only the most specific sibling", async () => {
    clearLoaderCache();
    const { App, calls } = usersApp("rank-client", "dynamic-first");
    const runtime = RouterRuntime.create({ app: App, history: RouterRuntime.createMemoryHistory("/") });
    Effect.runSync(runtime.initialize());
    await Effect.runPromise(runtime.navigate("/rank-client/new"));
    await tick();
    const snapshot = Effect.runSync(runtime.snapshot());
    expect(calls).toEqual(["new"]);
    expect(snapshot.appMatches).not.toContain("rank-client.detail");
    expect(snapshot.appMatches).toContain("rank-client.new");
  });

  it("ServerRoute dispatch/find prefers a static segment regardless of order", () => {
    const byId = ServerRoute.json({ key: "rank-user-by-id" }).pipe(
      ServerRoute.method("GET"),
      ServerRoute.path("/api/users/:id"),
      ServerRoute.handle(() => Effect.succeed({ which: "id" })),
    );
    const me = ServerRoute.json({ key: "rank-user-me" }).pipe(
      ServerRoute.method("GET"),
      ServerRoute.path("/api/users/me"),
      ServerRoute.handle(() => Effect.succeed({ which: "me" })),
    );
    expect(ServerRoute.find([byId, me], "GET", "/api/users/me")?.key).toBe("rank-user-me");
    expect(ServerRoute.find([byId, me], "GET", "/api/users/7")?.key).toBe("rank-user-by-id");
    expect(ServerRoute.find([me, byId], "GET", "/api/users/me")?.key).toBe("rank-user-me");
  });
});

describe("cache identity", () => {
  it("sorts keys by code unit, not locale", () => {
    expect(canonicalCacheParameters({ a: 1, B: 2 })).toBe('{"B":2,"a":1}');
  });
});

describe("durationToMillis", () => {
  it("parses decimal amounts", () => {
    expect(durationToMillis("1.5 seconds", 0)).toBe(1500);
    expect(durationToMillis("1.5s", 0)).toBe(1500);
    expect(durationToMillis("0.5 minutes", 0)).toBe(30_000);
  });

  it("throws a descriptive error for an unparseable string", () => {
    expect(() => durationToMillis("five minutes" as never, 0)).toThrow(/duration/i);
    expect(() => durationToMillis("10 fortnights" as never, 0)).toThrow(/10 fortnights/);
  });

  it("Route.loader rejects an unparseable duration where it is declared", () => {
    expect(() => Route.loader((_: {}) => Effect.succeed(1), { staleTime: "5 mintues" }))
      .toThrow(/staleTime.*5 mintues/);
    expect(() => Route.loader((_: {}) => Effect.succeed(1), { cacheTime: "1.5 hours" })).not.toThrow();
  });

  it("keeps undefined as the fallback", () => {
    expect(durationToMillis(undefined, 42)).toBe(42);
  });
});

describe("result record wire", () => {
  it("keeps a __proto__ route id through encode/decode", () => {
    const record = Object.create(null) as Record<string, CoreResultType<unknown, unknown>>;
    Object.defineProperty(record, "__proto__", {
      value: CoreResult.success(1),
      enumerable: true,
      writable: true,
      configurable: true,
    });
    record["other"] = CoreResult.success(2);
    const decoded = Serialization.decodeResultRecord(Serialization.encodeResultRecord(record));
    expect(Object.keys(decoded).sort()).toEqual(["__proto__", "other"]);
    expect(Object.prototype.hasOwnProperty.call(decoded, "__proto__")).toBe(true);
  });
});
