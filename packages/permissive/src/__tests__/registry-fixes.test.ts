import { describe, expect, it } from "vitest";
import { createHandleRegistry } from "../index.js";

describe("createHandleRegistry key moves", () => {
  it("bug 10: moving a handle to a new key retires the old key", () => {
    const r = createHandleRegistry();
    const h = {};
    r.register("old", h);
    r.register("new", h);
    expect(r.resolver.resolve("old")).toBeUndefined();
    r.unregister("old");
    expect(r.resolver.keyOf(h)).toBe("new");
    expect(r.resolver.resolve("new")).toBe(h);
  });

  it("re-registering a key with a different handle still replaces it", () => {
    const r = createHandleRegistry();
    const a = {};
    const b = {};
    r.register("k", a);
    r.register("k", b);
    expect(r.resolver.keyOf(a)).toBeUndefined();
    expect(r.resolver.keyOf(b)).toBe("k");
    expect(r.resolver.resolve("k")).toBe(b);
  });
});
