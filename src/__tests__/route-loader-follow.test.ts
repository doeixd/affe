/**
 * A mounted `Component.route` page follows its loader cache entry. Before,
 * its loader result was fixed at setup: navigating /users/1 → /users/2 kept
 * user 1's data, and neither a single-flight seed nor an invalidation reached
 * a page already on screen.
 */
import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import * as Component from "../Component.js";
import * as Route from "../Route.js";
import { createRoot, flush } from "../api.js";
import { Result, WithLayer, useService } from "../effect-ts.js";
import { clearLoaderCache, invalidateLoaderReactivity, setLoaderCacheEntry } from "../router-runtime.js";

const resolve = (value: unknown): unknown => {
  let current = value;
  while (typeof current === "function") current = (current as () => unknown)();
  return current;
};
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  clearLoaderCache();
  const db = new Map([["1", "Ada"], ["2", "Grace"]]);
  let loads = 0;
  const UserPage = Component.make(
    Component.props<{}>(),
    Component.require<Route.RouteContext<any, any, any>>(),
    () => Effect.map(Route.loaderData<string>(), (name) => ({ name })),
    (_props, b: { readonly name: () => string }) => `user:${b.name()}`,
  ).pipe(
    Component.route("/users/:id", { params: Schema.Struct({ id: Schema.String }) }),
    Route.loader((params: { readonly id: string }) =>
      Effect.sync(() => { loads += 1; return db.get(params.id) ?? "?"; }), { reactivityKeys: ["users"] }),
  );
  let router!: Route.RouterService;
  const { view, dispose } = createRoot((dispose) => ({
    dispose,
    view: (WithLayer({
      layer: Route.Router.Memory("/users/1"),
      children: () => {
        router = useService(Route.RouterTag);
        return Route.Switch({ children: [UserPage] });
      },
    }) as () => unknown)(),
  }));
  const go = (to: string) => { Effect.runSync(router.navigate(to)); flush(); };
  return { view, dispose, go, db, loads: () => loads, routeId: Route.routeMetaOf(UserPage)?.id ?? "/users/:id" };
}

describe("mounted route pages follow their loader entry", () => {
  it("loads the new params when the URL moves within the same route", async () => {
    const t = setup();
    expect(resolve(t.view)).toBe("user:Ada");
    t.go("/users/2");
    await tick(); flush();
    expect(resolve(t.view)).toBe("user:Grace");
    t.dispose();
  });

  it("reloads after an invalidation", async () => {
    const t = setup();
    expect(resolve(t.view)).toBe("user:Ada");
    const before = t.loads();
    t.db.set("1", "Ada Lovelace");
    invalidateLoaderReactivity(["users"]);
    flush(); await tick(); flush();
    expect(resolve(t.view)).toBe("user:Ada Lovelace");
    expect(t.loads()).toBe(before + 1);
    t.dispose();
  });

  it("shows an entry written by someone else (a single-flight seed) without reloading", () => {
    const t = setup();
    const before = t.loads();
    setLoaderCacheEntry(t.routeId, { id: "1" }, Result.success("Seeded"), { staleTime: "1 minute" });
    flush();
    expect(resolve(t.view)).toBe("user:Seeded");
    expect(t.loads()).toBe(before);
    t.dispose();
  });
});
