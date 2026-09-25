import { Effect, Exit, Option, Scope } from "effect";
import { createDisposableEffect, createRoot, onCleanup } from "./api.js";
import { getOwner, runWithOwner, type Owner } from "./owner.js";
import { parseAttribute, serializeAttribute } from "./attributes.js";
import * as MetadataToken from "./MetadataToken.js";
import { cssPropertyNameOf, inlineStyleDeclarations } from "./style-runtime.js";

type EventHandler = (event: unknown) => void;

type Cleanup = () => void;

/**
 * Renderer-neutral element handle.
 *
 * Handles are the runtime objects styles, behaviors, tests, and diagnostics
 * operate on. A handle is in-memory until it is bound to a rendered element
 * (`View.Slot.ref(...)` / `ref(...)` / `bindElement(...)`); while bound, its
 * writes and listeners reach that element. Tests use the same interface
 * without a DOM.
 */
export interface Handle {
  readonly id: string;
  listen(event: string, handler: EventHandler): Effect.Effect<Cleanup>;
  on(event: string, handler: EventHandler): Effect.Effect<void>;
  emit(event: string, eventData?: unknown): void;
  setAttr(name: string, value: unknown | (() => unknown)): Effect.Effect<void>;
  getAttr(name: string): unknown;
  setStyle(prop: string, value: () => unknown): Effect.Effect<void>;
  setStyleOnce(prop: string, value: unknown): Effect.Effect<void>;
  getStyle(prop: string): unknown;
}

/** Element that can participate in interactive behavior. */
export interface Interactive extends Handle {
  readonly kind: string;
}

/** Container-like element handle. */
export interface Container extends Interactive {
  readonly kind: "Container";
}

/** Element handle that can receive focus and blur events. */
export interface Focusable extends Interactive {
  readonly kind: string;
  focus(): void;
  blur(): void;
}

/** Text-input capable element handle. */
export interface TextInput extends Focusable {
  readonly kind: "TextInput";
}

/** Draggable element handle. */
export interface Draggable extends Interactive {
  readonly kind: "Draggable";
}

/**
 * Reactive collection of element handles for repeated slots.
 *
 * `observeEach` runs immediately for current items and re-runs when the
 * collection changes, cleaning up per-item finalizers.
 */
export interface Collection<E extends Handle> {
  readonly _tag: "Collection";
  readonly items: () => ReadonlyArray<E>;
  set(items: ReadonlyArray<E>): void;
  forEach(f: (item: E, index: number) => Effect.Effect<void>): Effect.Effect<void>;
  observeEach(f: (item: E, index: number) => Effect.Effect<Cleanup | void>): Effect.Effect<void>;
}

/** Parent capability reference accepted by `Capability.make`. */
export type CapabilityParent = string | MetadataToken.MetadataToken<"element.capability", string>;

/** Branded element capability with an inheritance list. */
export interface Capability<
  Name extends string = string,
  Extends extends readonly CapabilityParent[] = readonly [],
> extends MetadataToken.MetadataToken<"element.capability", Name> {
  readonly extends: Extends;
}

export namespace Capability {
  export type Any = Capability<string, readonly CapabilityParent[]>;
  export type NameOf<T> = MetadataToken.NameOf<T>;
  export type NamesOf<T extends readonly unknown[]> = MetadataToken.NamesOf<T>;
  export type ExtendsOf<T> = T extends Capability<any, infer Extends> ? MetadataToken.NameOf<Extends[number]> : never;
  export type AssignableNamesOf<T> =
    T extends string ? T
      : T extends Capability<any, infer Extends>
        ? MetadataToken.NameOf<T> | AssignableNamesOf<Extends[number]>
        : MetadataToken.NameOf<T>;

  const parentsByName = new Map<string, ReadonlyArray<string>>();

  /**
   * Create a custom capability token.
   *
   * @example
   * const Select = Element.Capability.make("Select", {
   *   extends: [Element.Capability.Focusable],
   * })
   */
  export function make<const Name extends string, const Extends extends readonly CapabilityParent[] = readonly []>(
    name: Name,
    options?: {
      readonly extends?: Extends;
    },
  ): Capability<Name, Extends> {
    const parents = options?.extends ?? [] as unknown as Extends;
    parentsByName.set(name, parents.map((parent) => MetadataToken.nameOf(parent)));
    return {
      ...MetadataToken.make("element.capability", name),
      extends: parents,
    };
  }

  export const Base = make("Base");
  export const Interactive = make("Interactive", { extends: [Base] });
  export const Container = make("Container", { extends: [Interactive] });
  export const Focusable = make("Focusable", { extends: [Interactive] });
  export const TextInput = make("TextInput", { extends: [Focusable] });
  export const Draggable = make("Draggable", { extends: [Interactive] });
  export const Collection = make("Collection", { extends: [Base] });

  export function extendsCapability(value: string | Any, base: string | Any): boolean {
    const valueName = MetadataToken.nameOf(value);
    const baseName = MetadataToken.nameOf(base);
    if (valueName === baseName) return true;
    const visited = new Set<string>();
    const stack = [...(parentsByName.get(valueName) ?? [])];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === baseName) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      stack.push(...(parentsByName.get(current) ?? []));
    }
    return false;
  }
}

/** Normalize a raw or branded capability to its string name. */
export function nameOfCapability(value: string | Capability.Any): string {
  return MetadataToken.nameOf(value);
}

/** Return true when `value` is equal to or inherits from `base`. */
export function extendsCapability(value: string | Capability.Any, base: string | Capability.Any): boolean {
  return Capability.extendsCapability(value, base);
}

type ListenerMap = Map<string, Set<EventHandler>>;

// ── Element binding (DQ-073) ────────────────────────────────────────────────

/**
 * Minimal element surface a handle binds to: the browser DOM and the server
 * document (`src/dom.ts`) both satisfy it. Everything is optional so a bind
 * degrades instead of throwing on a partial host.
 */
export interface BindableElement {
  setAttribute?(name: string, value: string): void;
  removeAttribute?(name: string): void;
  addEventListener?(name: string, listener: (event: unknown) => void): void;
  removeEventListener?(name: string, listener: (event: unknown) => void): void;
  focus?(): void;
  blur?(): void;
  readonly style?: {
    setProperty?(name: string, value: string): void;
    removeProperty?(name: string): void;
  };
  readonly tagName?: string;
  readonly nodeName?: string;
  getAttribute?(name: string): string | null;
}

/** Attribute stamped on every bound element: `data-af-slot="<slot name>"`. */
export const SLOT_ATTRIBUTE = "data-af-slot";

interface HandleInternals {
  bind(element: BindableElement): Cleanup;
  element(): BindableElement | undefined;
}

const handleInternals = new WeakMap<object, HandleInternals>();

/** CSS property name for a style key: camelCase to kebab-case, custom properties verbatim. */
export const cssPropertyName = cssPropertyNameOf;

/** Elements whose native activation already turns Enter/Space into `click`. */
function activatesNatively(element: BindableElement): boolean {
  const tag = String(element.tagName ?? element.nodeName ?? "").toLowerCase();
  if (tag === "button" || tag === "select" || tag === "textarea" || tag === "summary") return true;
  if (tag === "a") return element.getAttribute?.("href") != null;
  if (tag === "input") {
    const type = (element.getAttribute?.("type") ?? "text").toLowerCase();
    return type !== "hidden";
  }
  return false;
}

/**
 * Bind a handle to the rendered element it names (DQ-073).
 *
 * While bound, the handle is element-backed: its current attributes and
 * styles replay onto `element`, every later `setAttr` / `setStyle` /
 * `setStyleOnce` (reactive re-runs included) writes through, each event name
 * with handlers gets a real listener that dispatches to the same handler set
 * `emit` uses (the abstract `press` event maps to `click` plus Enter/Space on
 * elements without native keyboard activation), and `focus()` / `blur()` on
 * focusable handles call the element's. `slot` stamps
 * `data-af-slot="<slot>"`.
 *
 * Returns an idempotent unbind that removes the listeners and stops writing
 * through; the handle keeps its in-memory state, so rebinding to a new
 * element (a re-render) replays it. A handle is bound to at most one element:
 * binding again moves it. Handles not created by this module only get the
 * `data-af-slot` stamp.
 *
 * Authored code binds through `View.Slot.ref(...)`, which calls this from a
 * JSX `ref` and unbinds on the owner's cleanup.
 */
export function bindElement(
  handle: Handle,
  element: BindableElement,
  slot?: string,
): Cleanup {
  if (slot !== undefined) element.setAttribute?.(SLOT_ATTRIBUTE, slot);
  const internals = handleInternals.get(handle);
  if (internals === undefined) return () => {};
  return internals.bind(element);
}

/**
 * A JSX `ref` callback that binds `handle` to the element it lands on and
 * unbinds when the ref's reactive owner is cleaned up (the element leaves or
 * the component unmounts). The low-level form of `View.Slot.ref(...)` for
 * handles that do not come from a slot contract (e.g. headless composables).
 *
 * @example
 * <button ref={Element.ref(cb.trigger, "trigger")}>Toggle</button>
 */
export function ref(handle: Handle, slot?: string): (element: unknown) => void {
  return (element) => {
    if (element === null || element === undefined) return;
    onCleanup(bindElement(handle, element as BindableElement, slot));
  };
}

/** The element a handle is currently bound to, if any. */
export function boundElementOf(handle: Handle): BindableElement | undefined {
  return handleInternals.get(handle)?.element();
}

function makeHandle<T extends string>(tag: T): Handle & { readonly kind: T } {
  const attrs = new Map<string, unknown>();
  const styles = new Map<string, unknown>();
  const listeners: ListenerMap = new Map();

  interface Binding {
    readonly element: BindableElement;
    /** DOM listener removers keyed by the handle-level event name. */
    readonly dom: Map<string, Cleanup>;
  }
  let binding: Binding | undefined;

  const writeAttr = (name: string, serialized: string | null): void => {
    if (binding === undefined) return;
    if (serialized === null) binding.element.removeAttribute?.(name);
    else binding.element.setAttribute?.(name, serialized);
  };

  const writeStyle = (prop: string, value: unknown): void => {
    const style = binding?.element.style;
    if (style === undefined) return;
    for (const [name, text] of inlineStyleDeclarations(prop, value)) {
      if (text === null) style.removeProperty?.(name);
      else style.setProperty?.(name, text);
    }
  };

  const dispatch = (event: string, eventData: unknown): void => {
    const set = listeners.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      handler(eventData);
    }
  };

  const installDomListener = (event: string): void => {
    if (binding === undefined || binding.dom.has(event)) return;
    const element = binding.element;
    if (typeof element.addEventListener !== "function") return;
    const removers: Array<Cleanup> = [];
    const listen = (domEvent: string, listener: (event: unknown) => void): void => {
      element.addEventListener!(domEvent, listener);
      removers.push(() => element.removeEventListener?.(domEvent, listener));
    };
    if (event === "press") {
      listen("click", (domEvent) => dispatch("press", domEvent));
      if (!activatesNatively(element)) {
        listen("keydown", (domEvent) => {
          const key = (domEvent as { readonly key?: string; readonly repeat?: boolean } | null);
          if (key?.repeat === true) return;
          if (key?.key !== "Enter" && key?.key !== " " && key?.key !== "Spacebar") return;
          if (key.key !== "Enter") (domEvent as { preventDefault?: () => void }).preventDefault?.();
          dispatch("press", domEvent);
        });
      }
    } else {
      listen(event, (domEvent) => dispatch(event, domEvent));
    }
    binding.dom.set(event, () => {
      for (const remove of removers) remove();
    });
  };

  const removeDomListener = (event: string): void => {
    const remove = binding?.dom.get(event);
    if (remove === undefined) return;
    binding!.dom.delete(event);
    remove();
  };

  const unbindCurrent = (): void => {
    const current = binding;
    if (current === undefined) return;
    binding = undefined;
    for (const remove of current.dom.values()) remove();
    current.dom.clear();
  };

  /**
   * Create a reactive reaction whose lifetime is owned by the ambient Effect
   * `Scope` when one is present, falling back to the reactive render owner.
   *
   * Without this, a reaction created outside a render owner (behavior/style
   * attachment through a scoped path, resume reattachment) would be permanent:
   * unlike a leaked listener, it keeps recomputing on every dependency change
   * for the life of the process.
   *
   * The reaction is always parented to the ambient reactive owner, so the
   * ordinary DOM mount path is unchanged. `dispose` is idempotent, so when both
   * an owner and a Scope are present the teardown still runs exactly once.
   */
  const reaction = (run: () => void): Effect.Effect<void> =>
    Effect.flatMap(Effect.serviceOption(Scope.Scope), (maybeScope) => {
      const dispose = createDisposableEffect(run);
      if (Option.isSome(maybeScope)) {
        return Scope.addFinalizer(maybeScope.value, Effect.sync(dispose));
      }
      return Effect.void;
    });

  const base: Handle & { readonly kind: T } = {
    kind: tag,
    id: `el-${Math.random().toString(36).slice(2, 10)}`,
    listen(event, handler) {
      return Effect.sync(() => {
        const set = listeners.get(event) ?? new Set<EventHandler>();
        set.add(handler);
        listeners.set(event, set);
        installDomListener(event);
        return () => {
          set.delete(handler);
          if (set.size === 0) removeDomListener(event);
        };
      });
    },
    on(event, handler) {
      // Removal is owned by the ambient Effect `Scope` when one is present, so
      // listeners acquired outside a reactive render owner (behavior
      // reattachment / resume, `Component.setupEffect`) are still removed on
      // scope close. The reactive owner is only the fallback for callers that
      // run without a Scope (e.g. plain render owners).
      return base.listen(event, handler).pipe(
        Effect.flatMap((cleanup) =>
          Effect.flatMap(Effect.serviceOption(Scope.Scope), (maybeScope) => {
            let removed = false;
            const removeOnce = () => {
              if (removed) return;
              removed = true;
              cleanup();
            };
            if (Option.isSome(maybeScope)) {
              return Scope.addFinalizer(maybeScope.value, Effect.sync(removeOnce));
            }
            return Effect.sync(() => {
              onCleanup(removeOnce);
            });
          })
        ),
        Effect.asVoid,
      );
    },
    emit(event, eventData) {
      dispatch(event, eventData);
    },
    // DQ-068: writes serialize and reads parse through the ONE attribute
    // contract (`src/attributes.ts`), so this test handle and the DOM/SSR
    // renderer agree by construction — `false` removes, booleans read back
    // as booleans, numbers as numbers, absent reads are `undefined`.
    setAttr(name, value) {
      const write = (next: unknown): void => {
        const serialized = serializeAttribute(name, next);
        if (serialized === null) {
          attrs.delete(name);
        } else {
          attrs.set(name, serialized);
        }
        writeAttr(name, serialized === null ? null : String(serialized));
      };
      if (typeof value === "function") {
        return reaction(() => {
          write((value as () => unknown)());
        });
      }
      return Effect.sync(() => {
        write(value);
      });
    },
    getAttr(name) {
      const raw = attrs.get(name);
      return parseAttribute(name, raw === undefined ? null : String(raw));
    },
    setStyle(prop, value) {
      return reaction(() => {
        const next = value();
        styles.set(prop, next);
        writeStyle(prop, next);
      });
    },
    setStyleOnce(prop, value) {
      return Effect.sync(() => {
        styles.set(prop, value);
        writeStyle(prop, value);
      });
    },
    getStyle(prop) {
      return styles.get(prop);
    },
  };

  handleInternals.set(base, {
    element: () => binding?.element,
    bind(element) {
      if (binding?.element === element) return () => {};
      unbindCurrent();
      const next: Binding = { element, dom: new Map() };
      binding = next;
      for (const [name, value] of attrs) writeAttr(name, String(value));
      for (const [prop, value] of styles) writeStyle(prop, value);
      for (const [event, set] of listeners) {
        if (set.size > 0) installDomListener(event);
      }
      return () => {
        if (binding === next) unbindCurrent();
      };
    },
  });

  return base;
}

/**
 * Create the default handle for a capability, using the capability hierarchy
 * to pick the most specific built-in factory (a custom capability extending
 * `TextInput` gets a text-input handle). Unknown capabilities get a plain
 * base handle tagged with the capability name.
 */
export function handleFor(capability: string | Capability.Any): Handle | Collection<Handle> {
  const name = nameOfCapability(capability);
  if (extendsCapability(name, "TextInput")) return textInput();
  if (extendsCapability(name, "Focusable")) return focusable();
  if (extendsCapability(name, "Draggable")) return draggable();
  if (extendsCapability(name, "Container")) return container();
  if (extendsCapability(name, "Collection")) return collection();
  if (extendsCapability(name, "Interactive")) return interactive();
  return makeHandle(name);
}

/** Create an in-memory interactive handle. */
export function interactive(): Interactive {
  return makeHandle("Interactive") as Interactive;
}

/** Create an in-memory container handle. */
export function container(): Container {
  return makeHandle("Container") as Container;
}

/** Create an in-memory focusable handle. */
export function focusable(): Focusable {
  return withFocus(makeHandle("Focusable") as Focusable);
}

/** Create an in-memory text input handle. */
export function textInput(): TextInput {
  return withFocus(makeHandle("TextInput") as TextInput);
}

/**
 * `focus()` / `blur()` call the bound element's (whose real focus events then
 * reach listeners); an unbound handle emits the event in memory.
 */
function withFocus<H extends Focusable>(h: H): H {
  h.focus = () => {
    const element = boundElementOf(h);
    if (typeof element?.focus === "function") element.focus();
    else h.emit("focus");
  };
  h.blur = () => {
    const element = boundElementOf(h);
    if (typeof element?.blur === "function") element.blur();
    else h.emit("blur");
  };
  return h;
}

/** Create an in-memory draggable handle. */
export function draggable(): Draggable {
  return makeHandle("Draggable") as Draggable;
}

/** Create an in-memory collection handle for repeated slots. */
export function collection<E extends Handle>(initial: ReadonlyArray<E> = []): Collection<E> {
  let current = initial;
  interface Observer {
    readonly run: (item: E, index: number) => Effect.Effect<Cleanup | void>;
    readonly cleanups: Set<Cleanup>;
    /** Reactive owner ambient when `observeEach` ran; item roots nest under it. */
    readonly owner: Owner | null;
  }
  const observers = new Set<Observer>();

  /**
   * Run one per-item observer in its OWN child `Scope` and reactive root, so
   * every resource the item acquires (`setAttr(fn)` reactions, `on(...)`
   * listeners, nested finalizers) is released when that item's run is torn
   * down — on re-run, on removal, and on the observer's own disposal. Without
   * this, per-item work acquired inside `observeEach` had no Scope and piled
   * up on every `set()`, still writing to items no longer in the collection.
   */
  const runItem = (observer: Observer, item: E, index: number): Cleanup => {
    const itemScope = Effect.runSync(Scope.make());
    let disposeRoot: () => void = () => {};
    let out: Cleanup | void = undefined;
    try {
      out = runWithOwner(observer.owner, () =>
        createRoot((dispose) => {
          disposeRoot = dispose;
          return Effect.runSync(observer.run(item, index).pipe(Scope.provide(itemScope)));
        }),
      );
    } catch (error) {
      Effect.runSync(Scope.close(itemScope, Exit.void));
      disposeRoot();
      throw error;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      try {
        if (typeof out === "function") out();
      } finally {
        Effect.runSync(Scope.close(itemScope, Exit.void));
        disposeRoot();
      }
    };
  };

  const releaseAll = (observer: Observer): void => {
    const pending = [...observer.cleanups];
    observer.cleanups.clear();
    for (const cleanup of pending) {
      cleanup();
    }
  };

  const runObserver = (observer: Observer): void => {
    releaseAll(observer);
    for (let index = 0; index < current.length; index += 1) {
      const item = current[index];
      if (item === undefined) continue;
      observer.cleanups.add(runItem(observer, item, index));
    }
  };

  return {
    _tag: "Collection",
    items: () => current,
    set(items) {
      current = items;
      for (const observer of observers) {
        runObserver(observer);
      }
    },
    forEach(f) {
      return Effect.forEach(current, (item, index) => f(item, index)).pipe(Effect.asVoid);
    },
    observeEach(f) {
      // Teardown is owned by the ambient Effect `Scope` when one is present, so
      // observers registered outside a reactive render owner (behavior
      // reattachment / resume, `Component.setupEffect`) are still released on
      // scope close. The reactive owner is only the fallback for callers that
      // run without a Scope.
      return Effect.flatMap(Effect.serviceOption(Scope.Scope), (maybeScope) => {
        const observer: Observer = {
          run: f,
          cleanups: new Set<Cleanup>(),
          owner: getOwner(),
        };
        observers.add(observer);
        runObserver(observer);

        // Exactly-once at two levels: `disposed` guards the teardown itself,
        // and per-item cleanups are drained out of the live set (which
        // `runObserver` also drains on every re-run, so an item removed before
        // scope close was already released and is no longer reachable here).
        let disposed = false;
        const disposeOnce = () => {
          if (disposed) return;
          disposed = true;
          observers.delete(observer);
          releaseAll(observer);
        };

        if (Option.isSome(maybeScope)) {
          return Scope.addFinalizer(maybeScope.value, Effect.sync(disposeOnce));
        }
        return Effect.sync(() => {
          onCleanup(disposeOnce);
        });
      });
    },
  };
}

export const Element = {
  Capability,
  nameOfCapability,
  extendsCapability,
  interactive,
  container,
  focusable,
  textInput,
  draggable,
  collection,
  bindElement,
  boundElementOf,
  ref,
} as const;
