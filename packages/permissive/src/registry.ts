/**
 * The permissive hydration-handle registry (`PERMISSIVE_PACKAGE_PLAN.md` S4):
 * the client-side owner of the state-handle key space.
 *
 * The core codec's reference resolver is process-local, so a server-minted
 * handle key means nothing to a browser. This registry closes that gap by
 * making the KEYS the app's: register each resumable handle under a stable,
 * deployment-known key (a binding path, a route-scoped name) on BOTH sides,
 * and a payload serialized on the server resolves to the client's live
 * handle — the same identity discipline as `af:binding:` reactivity keys.
 *
 * Unknown keys still fail closed in the codec; this registry never invents a
 * handle.
 */

import type * as Serialization from "@doeixd/affe/Serialization";

export interface HandleRegistry {
  /**
   * Bind a stable key to a live handle. Re-registering a key replaces it;
   * registering a handle under a new key moves it (the old key is removed).
   */
  readonly register: (key: string, handle: object) => void;
  /** Remove a key (e.g. on component disposal). */
  readonly unregister: (key: string) => void;
  /** The resolver to pass to `permissive({ stateHandles })`. */
  readonly resolver: Serialization.StateHandleResolver;
}

export function createHandleRegistry(): HandleRegistry {
  const byKey = new Map<string, object>();
  const byHandle = new Map<object, string>();
  return {
    register: (key, handle) => {
      // A handle has exactly one key: moving it to a new key retires the old
      // one, so a later unregister of the stale key cannot orphan the handle.
      const previousKey = byHandle.get(handle);
      if (previousKey !== undefined && previousKey !== key) {
        byKey.delete(previousKey);
      }
      const previous = byKey.get(key);
      if (previous !== undefined && byHandle.get(previous) === key) {
        byHandle.delete(previous);
      }
      byKey.set(key, handle);
      byHandle.set(handle, key);
    },
    unregister: (key) => {
      const handle = byKey.get(key);
      if (handle !== undefined && byHandle.get(handle) === key) {
        byHandle.delete(handle);
      }
      byKey.delete(key);
    },
    resolver: {
      keyOf: (handle) => byHandle.get(handle),
      resolve: (key) => byKey.get(key),
    },
  };
}
