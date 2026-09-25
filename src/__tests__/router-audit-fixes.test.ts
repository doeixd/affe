/**
 * Regressions for the 2026-09 router/server/wire audit. Each test failed on
 * the code before its fix.
 */
import { describe, expect, it } from "vitest";
import { Deferred, Effect, Exit, Schema } from "effect";
import * as Component from "../Component.js";
import * as Route from "../Route.js";
import * as RouterRuntime from "../RouterRuntime.js";
import * as ServerRoute from "../ServerRoute.js";
import { extractPatternParams, substitutePattern } from "../route-pattern.js";
import {
  clearLoaderCache,
  getLoaderCacheEntry,
  invalidateLoaderReactivity,
  isFresh,
  runCachedLoader,
} from "../router-runtime.js";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe("router audit fixes", () => {
  it("single-flight revalidation re-reads loaders after the mutation (no shared cache)", () => {
    clearLoaderCache();
    let db = 0;
    const Counter = Route.loader(
      (_: { readonly id: string }) => Effect.sync(() => ({ count: db })),
      { staleTime: "5 minutes" },
    )(
      Route.paramsSchema(Schema.Struct({ id: Schema.String }))(
        Route.path("/audit-sf-counter/:id")(Component.from<{}>(() => null)),
      ),
    );
    const handler = Route.singleFlight((_: string) => Effect.sync(() => ++db), {
      app: Counter,
      baseUrl: "http://test.local",
      revalidate: "matched",
    });
    const run = () =>
      Effect.runSync(
        handler({ args: ["x"], url: "/audit-sf-counter/a" }) as Effect.Effect<
          Route.SingleFlightWireResponse,
          never,
          never
        >,
      );
    const countOf = (response: any) => response.payload.loaders[0].result.value.count;
    expect(countOf(run())).toBe(1);
    expect(countOf(run())).toBe(2);
  });

  it("an invalidation during an in-flight load leaves the result stale", async () => {
    clearLoaderCache();
    let db = 1;
    const options = { staleTime: "1 minute", staleWhileRevalidate: true, reactivityKeys: ["audit-todos"] } as const;
    await Effect.runPromise(runCachedLoader("audit-swr", {}, Effect.sync(() => db), options));
    invalidateLoaderReactivity(["audit-todos"]);
    const gate = Effect.runSync(Deferred.make<void>());
    const slow = Effect.gen(function* () {
      const seen = db;
      yield* Deferred.await(gate);
      return seen;
    });
    await Effect.runPromise(runCachedLoader("audit-swr", {}, slow, options));
    await tick(10);
    db = 2;
    invalidateLoaderReactivity(["audit-todos"]);
    Effect.runSync(Deferred.succeed(gate, undefined));
    await tick(20);
    const entry = getLoaderCacheEntry("audit-swr", {})!;
    expect((entry.result as { readonly value?: unknown }).value).toBe(1);
    expect(isFresh(entry)).toBe(false);
  });

  it("a malformed percent-escape is a non-match, not a crash", () => {
    const user = ServerRoute.json({ key: "audit-user" }).pipe(
      ServerRoute.method("GET"),
      ServerRoute.path("/users/:id"),
      ServerRoute.handle(({ params }) => Effect.succeed({ params })),
    );
    const exit = Effect.runSyncExit(
      ServerRoute.dispatch([user], new Request("http://example.com/users/%E0%A4%A")) as Effect.Effect<unknown>,
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(() => Route.matchPattern("/users/:id", "/users/%zz")).not.toThrow();
    expect(Route.matchPattern("/users/:id", "/users/%zz")).toBeFalsy();
  });

  it("a guard-refused navigation rolls the history back as well", async () => {
    const Guarded = Route.guard(Effect.fail({ _tag: "Denied" } as const))(
      Route.id("audit.guarded")(Route.path("/audit-guarded")(Component.from(() => null))),
    );
    const App = Route.children([Guarded])(
      Route.layout()(Route.path("/")(Component.from(() => null))),
    );
    const history = RouterRuntime.createMemoryHistory("/");
    const runtime = RouterRuntime.create({ app: App, history });
    Effect.runSync(runtime.initialize());
    await Effect.runPromise(runtime.navigate("/audit-guarded"));
    await tick();
    expect(Effect.runSync(runtime.snapshot()).location.pathname).toBe("/");
    expect(history.location().pathname).toBe("/");
  });

  it("submit really cancels an in-flight navigation", async () => {
    clearLoaderCache();
    const navGate = Effect.runSync(Deferred.make<void>());
    const submitGate = Effect.runSync(Deferred.make<void>());
    const Slow = Route.loader((_: {}) => Deferred.await(navGate).pipe(Effect.as(1)))(
      Route.id("audit.slow")(Route.path("/audit-slow")(Component.from(() => null))),
    );
    const App = Route.children([Slow])(Route.layout()(Route.path("/")(Component.from(() => null))));
    const action = ServerRoute.action({ key: "audit-save" }).pipe(
      ServerRoute.method("POST"),
      ServerRoute.path("/_server/audit-save"),
      ServerRoute.handle(() => Deferred.await(submitGate).pipe(Effect.as({ ok: true }))),
    );
    const runtime = RouterRuntime.create({ app: App, history: RouterRuntime.createMemoryHistory("/") });
    Effect.runSync(runtime.initialize());
    await Effect.runPromise(runtime.navigate("/audit-slow"));
    await tick();
    const pending = Effect.runPromise(runtime.submit(action, { method: "POST" }));
    await tick();
    Effect.runSync(Deferred.succeed(navGate, undefined));
    await tick();
    const phase = Effect.runSync(runtime.snapshot()).navigation.phase;
    Effect.runSync(Deferred.succeed(submitGate, undefined));
    await pending;
    expect(phase).toBe("submitting");
  });

  it("links encode splat values segment by segment", () => {
    const href = substitutePattern("/files/*", { "*": "a b/c?d#e" });
    expect(extractPatternParams("/files/*", new URL(href, "http://x").pathname, true)).toEqual({
      "*": "a b/c?d#e",
    });
  });

  it("a handoff entry matched by pattern is cached under the route id", () => {
    clearLoaderCache();
    const R = Route.loader((p: { readonly id: string }) => Effect.succeed(p.id))(
      Route.id("audit.hyd")(
        Route.paramsSchema(Schema.Struct({ id: Schema.String }))(
          Route.path("/audit-hyd/:id")(Component.from(() => null)),
        ),
      ),
    );
    Effect.runSync(
      Route.hydrateSingleFlightPayload(
        {
          mutation: undefined,
          url: "http://x/audit-hyd/1",
          loaders: [{ routeId: "/audit-hyd/:id", result: { _tag: "Success", value: "seeded" } as any }],
        },
        R as any,
      ),
    );
    expect(getLoaderCacheEntry("audit.hyd", { id: "1" })).toBeDefined();
  });

  it("cookie values are unquoted and percent-decoded", async () => {
    const route = ServerRoute.json({ key: "audit-cookie" }).pipe(
      ServerRoute.method("GET"),
      ServerRoute.path("/audit-cookie"),
      ServerRoute.cookies(Schema.Struct({ name: Schema.String, quoted: Schema.String, bad: Schema.String })),
      ServerRoute.handle(({ cookies }) => Effect.succeed(cookies)),
    );
    const request = new Request("http://example.com/audit-cookie", {
      headers: { cookie: 'name=John%20Doe; quoted="a b"; bad=%zz' },
    });
    const result = await Effect.runPromise(ServerRoute.execute(route as any, request) as Effect.Effect<any>);
    expect(JSON.stringify(result)).toContain("John Doe");
    expect(JSON.stringify(result)).toContain('"quoted":"a b"');
    expect(JSON.stringify(result)).toContain('"bad":"%zz"');
  });
});
