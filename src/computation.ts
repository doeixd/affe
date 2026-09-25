/**
 * computation.ts — Reactive computations (effects and memos).
 *
 * A Computation wraps a function `fn` that may read Signals. It:
 *   1. Runs `fn` under a tracking context so reads register deps.
 *   2. Subscribes to every Signal read.
 *   3. Re-runs when any dependency changes (invalidation).
 *   4. Before each re-run, disposes the previous run's sub-owner so that
 *      `onCleanup` callbacks registered during that run fire correctly.
 *   5. Disposes itself when its parent Owner is disposed.
 *
 * Per-run Owner model:
 *   - `_owner`    : lifetime = Computation lifetime. Registered on parent Owner.
 *   - `_runOwner` : lifetime = single execution. Replaced before every re-run.
 *     onCleanup() calls inside the fn attach to _runOwner so they fire before
 *     the next execution (not just on final disposal).
 *
 * Memo<T> extends Computation to cache its return value and expose a
 * getter — the canonical "derived signal" primitive.
 */

import { type IComputation, type ISignal, enqueueComputation, getObserver, setObserver } from "./tracking.js";
import { Owner, getOwner, runWithOwner } from "./owner.js";
import { defaultEquals, type EqualityFn } from "./signal.js";

export class Computation implements IComputation {
  protected _fn: () => unknown;
  protected _deps: ISignal<unknown>[] = [];
  /**
   * Dependencies newly captured during this execution.
   *
   * This follows Reactively's "prefix reuse" idea: if dependency access order
   * remains stable, we reuse existing links and avoid churn.
   */
  private _capturedDeps: ISignal<unknown>[] | null = null;
  private _depIndex = 0;
  /** Lifetime owner — tied to parent, governs entire computation lifetime. */
  protected _owner: Owner;
  /** Per-run owner — disposed before every re-execution for cleanup support. */
  private _runOwner: Owner | null = null;
  private _disposed = false;
  private _running = false;
  /**
   * Set when an invalidation arrives while `fn` is executing (e.g. a
   * self-write inside `batch()`, which flushes synchronously). The run that is
   * in progress cannot be restarted, so the computation re-runs once it ends.
   */
  private _rerunPending = false;

  /**
   * @param fn          - The reactive function to execute.
   * @param parentOwner - Owner that governs this computation's lifetime.
   * @param defer       - If true, skip the initial run (used by Memo so it can
   *                      set fields before the first execution).
   */
  constructor(
    fn: () => unknown,
    parentOwner: Owner | null = getOwner(),
    defer = false,
  ) {
    this._owner = new Owner(parentOwner);
    this._fn = fn;
    this._owner.addCleanup(() => this._dispose());
    if (!defer) this._run();
  }

  addDependency(signal: ISignal<unknown>): void {
    if (this._capturedDeps === null && this._deps[this._depIndex] === signal) {
      this._depIndex++;
      return;
    }
    if (this._capturedDeps === null) {
      this._capturedDeps = [signal];
      return;
    }
    this._capturedDeps.push(signal);
  }

  invalidate(): void {
    if (this._disposed) return;
    if (this._running) {
      this._rerunPending = true;
      return;
    }
    this._cleanupRunOwner();
    if (this._disposed) return;
    this._run();
  }

  private _cleanupRunOwner(): void {
    // Dispose the per-run sub-owner to fire onCleanup callbacks registered
    // during the previous run, and tear down nested effects/computations.
    if (this._runOwner !== null) {
      this._runOwner.dispose();
      this._runOwner = null;
    }
  }

  protected _run(): void {
    if (this._disposed) return;
    this._running = true;
    this._capturedDeps = null;
    this._depIndex = 0;

    // Fresh per-run owner as a child of the lifetime owner.
    // onCleanup() inside _execute() attaches here.
    this._runOwner = new Owner(this._owner);

    const prevObserver = setObserver(this);
    try {
      runWithOwner(this._runOwner, () => {
        try {
          this._execute();
        } catch (e) {
          console.error("[affe] Unhandled error in reactive computation:", e);
        }
      });
    } finally {
      setObserver(prevObserver);
      this._reconcileDependencies();
      this._capturedDeps = null;
      this._running = false;
    }
    if (this._rerunPending) {
      this._rerunPending = false;
      this.invalidate();
    }
  }

  /**
   * Unsubscribe from old dependencies `_deps[_depIndex..]` that were NOT read
   * again during this run. A dependency can move out of the reused prefix
   * (inserted/reordered reads) while still being read — it then lives in
   * `_capturedDeps` (or even in the prefix, for duplicate reads) and must stay
   * subscribed.
   */
  private _unsubscribeStale(): void {
    if (this._depIndex >= this._deps.length) return;
    const kept = new Set<ISignal<unknown>>();
    for (let i = 0; i < this._depIndex; i++) kept.add(this._deps[i]);
    if (this._capturedDeps !== null) {
      for (const dep of this._capturedDeps) kept.add(dep);
    }
    for (let i = this._depIndex; i < this._deps.length; i++) {
      const dep = this._deps[i];
      if (!kept.has(dep)) dep.removeSubscriber(this);
    }
  }

  private _reconcileDependencies(): void {
    this._unsubscribeStale();
    if (this._capturedDeps !== null) {

      if (this._depIndex > 0) {
        this._deps.length = this._depIndex + this._capturedDeps.length;
        for (let i = 0; i < this._capturedDeps.length; i++) {
          this._deps[this._depIndex + i] = this._capturedDeps[i];
        }
      } else {
        this._deps = this._capturedDeps;
      }
      return;
    }

    if (this._depIndex < this._deps.length) {
      this._deps.length = this._depIndex;
    }
  }

  protected _execute(): void {
    this._fn();
  }

  private _dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (let i = 0; i < this._deps.length; i++) {
      this._deps[i].removeSubscriber(this);
    }
    this._deps.length = 0;
    this._cleanupRunOwner();
  }

  get disposed(): boolean {
    return this._disposed;
  }
}

/**
 * Memo — a Computation that caches its return value.
 *
 * Only notifies its own downstream subscribers when the computed value
 * actually changes (per `equals`). The first run initialises the value
 * without notifying (no subscribers exist yet at construction time).
 */
export class Memo<T> extends Computation implements ISignal<T> {
  readonly pure = true;
  private _value: T | undefined = undefined;
  private _subscribers: Set<IComputation> = new Set();
  private _equals: EqualityFn<T>;
  private _initialized = false;

  constructor(
    fn: () => T,
    equals: EqualityFn<T> = defaultEquals as EqualityFn<T>,
    parentOwner: Owner | null = getOwner(),
  ) {
    // Defer the initial _run() so we can set _equals before the first execution.
    super(fn as () => unknown, parentOwner, /* defer = */ true);
    this._equals = equals;
    // Now run with _equals in place.
    this._run();
  }

  protected override _execute(): void {
    const next = (this._fn as () => T)();

    if (!this._initialized) {
      // First run: store the initial value. No subscribers to notify yet.
      this._initialized = true;
      this._value = next;
      return;
    }

    // Subsequent runs: notify only when the value actually changes.
    // Subscribers are queued rather than invalidated synchronously: sibling
    // memos invalidated by the same change may still be pending, and the
    // scheduler settles all memos before any effect runs (no diamond glitch).
    if (!this._equals(this._value as T, next)) {
      this._value = next;
      for (const sub of this._subscribers) {
        enqueueComputation(sub);
      }
    }
  }

  /** Read the memoised value; registers this memo as a dep of the caller. */
  get(): T {
    if (!this._initialized) {
      throw new Error("[affe] Memo read before initialization (circular dependency?)");
    }
    const observer = getObserver();
    if (observer !== null) {
      this._subscribers.add(observer);
      observer.addDependency(this as ISignal<unknown>);
    }
    return this._value as T;
  }

  removeSubscriber(computation: IComputation): void {
    this._subscribers.delete(computation);
  }
}
