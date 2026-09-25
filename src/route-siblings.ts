/**
 * Sibling ranking for component-first routes (`Component.route`).
 *
 * Every routed component call registers its pattern with the router it runs
 * under. A call is active while its pattern matches the URL and no competing
 * registered pattern matches more specifically — the same ranking the route
 * tree, `ServerRoute` and `Route.Switch` use. Patterns where one is a
 * segment prefix of the other (`/users` and `/users/:id`) do not compete:
 * that is a layout and its child, and both render. Identical patterns do not
 * compete either.
 *
 * The routed component's instance (setup, guards, loader, view) exists only
 * while its call is active, so a page mounted on a URL it does not match
 * renders once navigation reaches it, and a page that loses to a sibling
 * never runs its loader.
 */
import { createMemo, createSignal, getOwner, onCleanup, untrack, type Accessor } from "./api.js";
import { runWithOwner } from "./owner.js";
import { comparePatternSpecificity, matchPatternSegments } from "./route-pattern.js";

export interface RouteGate {
  readonly pattern: string;
  readonly exact: boolean;
}

interface Registry {
  readonly entries: Accessor<ReadonlyArray<RouteGate>>;
  readonly add: (entry: RouteGate) => void;
  readonly remove: (entry: RouteGate) => void;
}

const registries = new WeakMap<object, Registry>();

function registryFor(router: object): Registry {
  let registry = registries.get(router);
  if (registry === undefined) {
    const [entries, setEntries] = createSignal<ReadonlyArray<RouteGate>>([]);
    registry = {
      entries,
      add: (entry) => setEntries((current) => [...current, entry]),
      remove: (entry) => setEntries((current) => current.filter((other) => other !== entry)),
    };
    registries.set(router, registry);
  }
  return registry;
}

const segmentsOf = (pattern: string): ReadonlyArray<string> => pattern.split("/").filter(Boolean);

function isSegmentPrefix(prefix: string, pattern: string): boolean {
  const left = segmentsOf(prefix);
  const right = segmentsOf(pattern);
  return left.length <= right.length && left.every((segment, index) => segment === right[index]);
}

function competes(a: RouteGate, b: RouteGate): boolean {
  return !isSegmentPrefix(a.pattern, b.pattern) && !isSegmentPrefix(b.pattern, a.pattern);
}

/**
 * Wrap a routed component call: `create` runs (under the returned accessor's
 * reactive scope) only while this call wins its URL, and its instance is
 * disposed when it stops winning. Creation is deferred to the first read so
 * that siblings called in the same JSX expression are registered first.
 */
export function gateRoutedCall(
  router: { readonly url: () => URL },
  gate: RouteGate,
  create: () => unknown,
): () => unknown {
  const registry = registryFor(router);
  const entry: RouteGate = { pattern: gate.pattern, exact: gate.exact };
  const owner = getOwner();
  if (owner !== null) {
    registry.add(entry);
    onCleanup(() => registry.remove(entry));
  }

  const isActive = (): boolean => {
    const pathname = router.url().pathname;
    if (!matchPatternSegments(entry.pattern, pathname, entry.exact)) return false;
    for (const other of registry.entries()) {
      if (other === entry || !competes(other, entry)) continue;
      if (
        comparePatternSpecificity(other.pattern, entry.pattern) < 0
        && matchPatternSegments(other.pattern, pathname, other.exact)
      ) {
        return false;
      }
    }
    return true;
  };

  let view: Accessor<unknown> | undefined;
  return () => {
    if (view === undefined) {
      const build = (): Accessor<unknown> => {
        const active = createMemo(isActive);
        return createMemo(() => (active() ? untrack(create) : null));
      };
      view = owner === null ? build() : runWithOwner(owner, build);
    }
    return view();
  };
}
