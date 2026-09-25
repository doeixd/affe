import { Context, Effect, Exit, Scope } from "effect";
import { contextMap, createContext, getOwner, onCleanup, useContext } from "./api.js";
import type { Owner } from "./owner.js";

/**
 * Stamped on the accessor a component call returns, pointing back at the
 * component — so a parent such as `Route.Switch` can read the route metadata
 * of the children it was handed.
 */
export const ComponentInvocationSource: unique symbol = Symbol.for("affe/ComponentInvocationSource");

/** The component whose call produced `value`, if `value` is such a call's result. */
export function invocationSourceOf(value: unknown): unknown {
  return typeof value === "function"
    ? (value as { readonly [ComponentInvocationSource]?: unknown })[ComponentInvocationSource]
    : undefined;
}

export const ComponentScopeContext = createContext<Scope.Closeable | null>(null);

export function currentComponentScope(): Scope.Closeable | null {
  return useContext(ComponentScopeContext);
}

/**
 * Run `fn` with `scope` published as the current owner's component scope.
 *
 * The scope stays on the owner for the owner's whole life rather than only
 * for the synchronous call: descendants created LATER — a conditional child
 * created on an `insert` re-run, the children of a component whose setup
 * resolved asynchronously — resolve the nearest component scope by walking
 * the owner chain, so a temporary entry would leave them scope-less (setup
 * fails with a missing `Scope`, finalizers never run). Every caller passes
 * an owner dedicated to that scope (a component root, a mount's render
 * computation, a scoped root).
 */
export function withComponentScope<T>(scope: Scope.Closeable | null, fn: () => T): T {
  if (scope === null) return fn();
  const owner = getOwner();
  if (owner === null) return fn();
  setOwnerContext(owner, ComponentScopeContext.id, scope);
  return fn();
}

function setOwnerContext(owner: Owner, key: symbol, value: unknown): void {
  let map = contextMap.get(owner);
  if (!map) {
    map = new Map();
    contextMap.set(owner, map);
  }
  map.set(key, value);
}

/**
 * Services built by `Component.withLayer` for a component instance, published
 * on that instance's owner so descendant components' setup runs with them.
 */
export const ComponentServicesContext = createContext<Context.Context<never> | null>(null);

/** The nearest ancestor component's published layer services, if any. */
export function currentComponentServices(): Context.Context<never> | null {
  return useContext(ComponentServicesContext);
}

/**
 * Merge `services` into the services published on `owner` (outer
 * `withLayer`s publish first; inner ones add to them).
 */
export function publishComponentServices(
  owner: Owner,
  services: Context.Context<never>,
): void {
  const existing = contextMap.get(owner)?.get(ComponentServicesContext.id) as
    | Context.Context<never>
    | null
    | undefined;
  const inherited = existing ?? currentServicesFrom(owner.parent);
  setOwnerContext(
    owner,
    ComponentServicesContext.id,
    inherited == null ? services : Context.merge(inherited, services),
  );
}

function currentServicesFrom(owner: Owner | null): Context.Context<never> | null {
  let current = owner;
  while (current !== null) {
    const map = contextMap.get(current);
    if (map?.has(ComponentServicesContext.id)) {
      return map.get(ComponentServicesContext.id) as Context.Context<never> | null;
    }
    current = current.parent;
  }
  return null;
}

export function forkComponentScope(parent: Scope.Closeable | null): Scope.Closeable | null {
  if (parent === null) return null;
  return Scope.forkUnsafe(parent);
}

export function closeComponentScope(scope: Scope.Closeable | null): void {
  if (scope === null) return;
  Effect.runFork(Scope.close(scope, Exit.void));
}

export function bindScopeCleanup(scope: Scope.Closeable | null): void {
  if (scope === null) return;
  onCleanup(() => closeComponentScope(scope));
}
