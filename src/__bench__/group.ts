import { test, type Bench, type BenchFn, type BenchRegistration } from "vitest";

/**
 * One benchmark group. Vitest 5 made `bench` a test-context fixture rather
 * than a top-level export, so each former `describe` block becomes one test
 * that registers its benchmarks through `register` and then runs them
 * together, compared side by side.
 */
export function group(
  name: string,
  register: (bench: (name: string, fn: BenchFn) => void) => void,
): void {
  test(name, async ({ bench }: { bench: Bench }) => {
    const registrations: Array<BenchRegistration<string>> = [];
    register((benchName, fn) => {
      registrations.push(bench(benchName, fn));
    });
    if (registrations.length === 1) {
      await registrations[0]!.run();
    } else {
      await bench.compare(...registrations);
    }
  });
}
