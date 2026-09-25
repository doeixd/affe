/**
 * State-changing requests from another site are refused by default
 * (ServerRoute.checkOrigin, applied by execute and dispatch).
 */
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import * as ServerRoute from "../ServerRoute.js";

let calls = 0;
const save = ServerRoute.json({ key: "csrf-save" }).pipe(
  ServerRoute.method("POST"),
  ServerRoute.path("/api/save"),
  ServerRoute.handle(() => Effect.sync(() => { calls += 1; return { ok: true }; })),
);
const read = ServerRoute.json({ key: "csrf-read" }).pipe(
  ServerRoute.method("GET"),
  ServerRoute.path("/api/read"),
  ServerRoute.handle(() => Effect.succeed({ ok: true })),
);

const post = (headers: Record<string, string>, url = "https://app.example/api/save") =>
  new Request(url, { method: "POST", headers });
const run = (request: Request, options?: ServerRoute.ServerExecuteOptions) =>
  Effect.runPromise(ServerRoute.dispatch([save, read], request, options) as Effect.Effect<ServerRoute.DispatchResult>)
    .then((result) => (result._tag === "data" ? result.result : undefined));

describe("ServerRoute CSRF protection", () => {
  it("allows same-origin posts", async () => {
    expect((await run(post({ origin: "https://app.example" })))?.status).toBe(200);
    expect((await run(post({ "sec-fetch-site": "same-origin", origin: "https://proxy.internal" })))?.status).toBe(200);
  });

  it("refuses cross-site posts before the handler runs", async () => {
    const before = calls;
    const refused = await run(post({ origin: "https://evil.example" }));
    expect(refused?.status).toBe(403);
    expect(refused?.forbidden?.reason).toContain("https://evil.example");
    expect((await run(post({ "sec-fetch-site": "cross-site" })))?.status).toBe(403);
    expect((await run(post({ origin: "null" })))?.status).toBe(403);
    expect(calls).toBe(before);
  });

  it("allows trusted origins, non-browser clients, safe methods and an explicit opt-out", async () => {
    expect((await run(post({ origin: "https://admin.example" }), { csrf: { trustedOrigins: ["https://admin.example"] } }))?.status).toBe(200);
    expect((await run(post({})))?.status).toBe(200);
    const get = new Request("https://app.example/api/read", { headers: { origin: "https://evil.example" } });
    expect((await run(get))?.status).toBe(200);
    expect((await run(post({ origin: "https://evil.example" }), { csrf: false }))?.status).toBe(200);
  });

  it("is available on its own for hand-routed endpoints", () => {
    expect(ServerRoute.checkOrigin(post({ origin: "https://evil.example" }))).toEqual({
      ok: false,
      reason: "cross-origin POST from https://evil.example",
    });
    expect(ServerRoute.checkOrigin(post({ origin: "https://app.example" })).ok).toBe(true);
  });
});
