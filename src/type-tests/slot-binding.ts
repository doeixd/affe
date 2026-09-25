/**
 * DQ-073: `View.Slot.ref(contract, name)` accepts only the contract's declared
 * slot names and returns a callback the JSX `ref` prop accepts.
 */
import * as Element from "../Element.js";
import type { JSX } from "../jsx-runtime.js";
import * as View from "../View.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Expect<T extends true> = T;

const FieldSlots = View.Slots.define({
  root: { capability: Element.Capability.Container },
  input: { capability: Element.Capability.TextInput },
  options: { capability: Element.Capability.Collection },
});

const rootRef = View.Slot.ref(FieldSlots, "root");
const inputRef = View.Slot.ref(FieldSlots, "input");
// Collection slots bind one item handle per element the ref lands on.
const optionRef = View.Slot.ref(FieldSlots, "options");

export type RefIsCallback = Expect<Equal<typeof rootRef, View.Slot.Ref>>;

// The ref fits the existing JSX `ref` prop of any intrinsic element.
export const labelRef: JSX.IntrinsicElements["label"]["ref"] = rootRef;
export const inputElementRef: JSX.IntrinsicElements["input"]["ref"] = inputRef;
export const liRef: JSX.IntrinsicElements["li"]["ref"] = optionRef;

// @ts-expect-error — "label" is not a slot of FieldSlots.
View.Slot.ref(FieldSlots, "label");

const OtherSlots = View.Slots.define({ trigger: { capability: Element.Capability.Interactive } });
// @ts-expect-error — a name from another contract is rejected.
View.Slot.ref(OtherSlots, "root");

// The binding primitives stay reachable for custom renderers.
export const unbind: () => void = Element.bindElement(Element.interactive(), {}, "root");
export const bound: Element.BindableElement | undefined = Element.boundElementOf(Element.interactive());
