/**
 * tracking.ts — Global synchronous dependency tracking context.
 *
 * This is the beating heart of the reactive system. A single global
 * `currentObserver` pointer is set whenever a Computation is executing.
 * Any Signal read during that window registers itself as a dependency
 * of the running Computation — the same approach used by Solid, Vue, and MobX.
 */

export interface IComputation {
  /** Called by a Signal when it learns the computation depends on it. */
  addDependency(signal: ISignal<unknown>): void;
  /** Called by a Signal when its value has changed. */
  invalidate(): void;
  /**
   * True for pure derivations (memos). The scheduler settles every queued
   * pure computation before running any side-effecting one, so effects never
   * observe a half-updated set of derived values (diamond glitch).
   */
  readonly pure?: boolean;
}

export interface ISignal<T> {
  /** Remove a subscriber (called when a computation re-runs and re-collects deps). */
  removeSubscriber(computation: IComputation): void;
}

/** The computation that is currently executing (null when outside a reactive context). */
let currentObserver: IComputation | null = null;

export function getObserver(): IComputation | null {
  return currentObserver;
}

export function setObserver(obs: IComputation | null): IComputation | null {
  const prev = currentObserver;
  currentObserver = obs;
  return prev;
}

/** Run `fn` without tracking. Any signal reads inside will not register deps. */
export function runUntracked<T>(fn: () => T): T {
  const prev = setObserver(null);
  try {
    return fn();
  } finally {
    setObserver(prev);
  }
}

/**
 * Batch flag. When > 0, Signal writes are queued rather than immediately
 * propagated. Flushes when the outermost batch exits.
 *
 * Queued work is split in two: pure computations (memos) and effects. `flush`
 * always drains the pure queue first, so by the time an effect runs, every
 * memo invalidated by the same change has recomputed.
 */
let batchDepth = 0;
const pureQueue: Set<IComputation> = /*#__PURE__*/ new Set();
const effectQueue: Set<IComputation> = /*#__PURE__*/ new Set();
let microtaskScheduled = false;

export function isBatching(): boolean {
  return batchDepth > 0;
}

export function enqueueComputation(comp: IComputation): void {
  (comp.pure === true ? pureQueue : effectQueue).add(comp);
  if (batchDepth === 0 && !microtaskScheduled) {
    microtaskScheduled = true;
    queueMicrotask(() => {
      microtaskScheduled = false;
      flush();
    });
  }
}

function takeFirst(queue: Set<IComputation>): IComputation {
  const next = queue.values().next().value as IComputation;
  queue.delete(next);
  return next;
}

export function flush(): void {
  while (pureQueue.size > 0 || effectQueue.size > 0) {
    const comp = pureQueue.size > 0 ? takeFirst(pureQueue) : takeFirst(effectQueue);
    comp.invalidate();
  }
}

export function runBatch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      flush();
    }
  }
}
