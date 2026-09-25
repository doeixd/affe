/**
 * Background policies (withPolling / withStaleTime / withRetry) live as long
 * as at least one reactive reader holds the atom — not per read. Before the
 * fix each read restarted or stopped the timer, so frequent re-reads starved
 * polling and stale refreshes, and one reader unmounting stopped polling for
 * every other reader.
 */
import { describe, expect, it } from "vitest";
import { Effect, Layer, Schedule } from "effect";
import * as Atom from "../Atom.js";
import { createEffect, createRoot, createSignal, flush } from "../api.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function counterAtom() {
  let runs = 0;
  const rt = Atom.runtime(Layer.empty);
  const atom = rt.atom(Effect.sync(() => ++runs));
  return { atom, runs: () => runs };
}

describe("atom policy lifetime", () => {
  it("polling keeps running while another reader still holds the atom", async () => {
    const { atom, runs } = counterAtom();
    const polled = Atom.withPolling(atom, Schedule.spaced("15 millis"));
    const disposeA = createRoot((dispose) => {
      createEffect(() => { polled(); });
      return dispose;
    });
    const disposeB = createRoot((dispose) => {
      createEffect(() => { polled(); });
      return dispose;
    });
    await sleep(10);
    flush();
    disposeA();
    const before = runs();
    await sleep(80);
    flush();
    expect(runs()).toBeGreaterThan(before);
    disposeB();
  });

  it("polling fires even when its reader re-runs more often than the interval", async () => {
    const { atom, runs } = counterAtom();
    const polled = Atom.withPolling(atom, Schedule.spaced("40 millis"));
    const [tick, setTick] = createSignal(0);
    const dispose = createRoot((d) => {
      createEffect(() => { tick(); polled(); });
      return d;
    });
    await sleep(5);
    flush();
    const before = runs();
    for (let i = 0; i < 20; i += 1) {
      setTick(i + 1);
      flush();
      await sleep(10);
    }
    flush();
    expect(runs()).toBeGreaterThan(before);
    dispose();
  });

  it("stops polling once the last reader is gone", async () => {
    const { atom, runs } = counterAtom();
    const polled = Atom.withPolling(atom, Schedule.spaced("10 millis"));
    const dispose = createRoot((d) => {
      createEffect(() => { polled(); });
      return d;
    });
    await sleep(30);
    flush();
    dispose();
    await sleep(5);
    const after = runs();
    await sleep(60);
    expect(runs()).toBe(after);
  });

  it("stale refresh fires even when its reader re-reads frequently", async () => {
    const { atom, runs } = counterAtom();
    const stale = Atom.withStaleTime(atom, 40);
    const [tick, setTick] = createSignal(0);
    const dispose = createRoot((d) => {
      createEffect(() => { tick(); stale(); });
      return d;
    });
    await sleep(5);
    flush();
    const before = runs();
    for (let i = 0; i < 20; i += 1) {
      setTick(i + 1);
      flush();
      await sleep(10);
    }
    flush();
    expect(runs()).toBeGreaterThan(before);
    dispose();
  });
});
