import { defaultThemeTokens, type SlotStyle, type ThemeTokenSchema } from "./style-types.js";
import { isStructuredTokenLeaf, lookupToken } from "./Theme.js";

export function mergeStyle(a: SlotStyle, b: SlotStyle): SlotStyle {
  return { ...a, ...b };
}

export function mergeMany(styles: ReadonlyArray<SlotStyle>): SlotStyle {
  let out: SlotStyle = {};
  for (const style of styles) {
    out = mergeStyle(out, style);
  }
  return out;
}

/**
 * Map a CSS property to the token category its BARE token names resolve in.
 *
 * Property-aware resolution is what keeps token sugar from hijacking CSS
 * keywords: without it, `display: "none"` resolves through `radius.none` and
 * `color: "sm"`-style collisions are one token schema away. A bare name only
 * resolves in its property's own category; a DOTTED path (`"color.accent.hover"`,
 * `"text.primary"`) resolves anywhere, because writing a dot is an explicit
 * request for a token.
 */
export function tokenCategoryOfProperty(property: string): string | undefined {
  const normalized = property.toLowerCase();
  if (/color|background$|^fill$|^stroke$|caret|accent-?color/.test(normalized)) return "color";
  if (
    /^(gap|row-?gap|column-?gap|top|right|bottom|left)$|margin|padding|inset|^translate/.test(
      normalized,
    )
  ) {
    return "spacing";
  }
  if (/font-?size/.test(normalized)) return "fontSize";
  if (/font-?weight/.test(normalized)) return "fontWeight";
  if (/radius/.test(normalized)) return "radius";
  if (/shadow/.test(normalized)) return "shadow";
  if (/^transition/.test(normalized)) return "transition";
  return undefined;
}

function lookupPath(tokens: unknown, path: string): unknown {
  if (typeof tokens !== "object" || tokens === null) return undefined;
  const record = tokens as Record<string, unknown>;
  // Literal dotted keys first: several categories key tokens as "body.sm".
  if (path in record) return record[path];
  const dot = path.indexOf(".");
  if (dot === -1) return undefined;
  return lookupPath(record[path.slice(0, dot)], path.slice(dot + 1));
}

/**
 * The one property-aware token resolution: returns the full token PATH a
 * string value resolves through for `property`, or `undefined` when the
 * value is not a token. Shared by the runtime (which then reads the value)
 * and static extraction (which emits `var(--af-<path>)`).
 */
export function tokenPathForProperty(
  tokens: ThemeTokenSchema,
  property: string | undefined,
  value: string,
): string | undefined {
  // Structured leaves (shadow objects) are single token VALUES, so
  // `shadow: "md"` resolves to the whole `{ x, y, blur, color }` object.
  const isLeaf = (candidate: unknown): boolean =>
    typeof candidate === "string" || typeof candidate === "number" || isStructuredTokenLeaf(candidate);
  if (value.includes(".")) {
    // A dotted path is an explicit token request: try it verbatim, then under
    // each category prefix (`"text.primary"` → `color.text.primary`).
    const prefixes = ["", "color.", "spacing.", "fontSize.", "fontWeight.", "radius.", "shadow.", "transition.", "breakpoint."];
    for (const prefix of prefixes) {
      const path = `${prefix}${value}`;
      if (isLeaf(lookupPath(tokens, path))) return path;
    }
    return undefined;
  }
  // A bare name resolves ONLY in its property's category.
  const category = property === undefined ? undefined : tokenCategoryOfProperty(property);
  if (category === undefined) return undefined;
  const path = `${category}.${value}`;
  return isLeaf(lookupPath(tokens, path)) ? path : undefined;
}

/**
 * Resolve a style value's token references to concrete values.
 *
 * With a `property`, resolution is property-aware (see
 * `tokenPathForProperty`); without one, it falls back to the historical
 * category-scanning `lookupToken` — kept for non-property contexts such as
 * theme lookups.
 */
export function resolveTokenValue(
  value: unknown,
  tokens: ThemeTokenSchema = defaultThemeTokens,
  property?: string,
): unknown {
  if (typeof value === "string") {
    if (property !== undefined) {
      const path = tokenPathForProperty(tokens, property, value);
      return path === undefined ? value : lookupPath(tokens, path);
    }
    return lookupToken(tokens, value);
  }
  if (Array.isArray(value)) {
    // Tuple shorthands (`padding: [8, "md"]`) resolve every entry under the
    // SAME property, and stay arrays.
    return value.map((entry) => resolveTokenValue(entry, tokens, property));
  }
  if (typeof value === "object" && value !== null) {
    // Structured values (`border: { width, color }`, `flex: { gap }`, a
    // shadow's `color`) resolve each field under its OWN key when that key
    // names a token category — the parent property (`border`, `flex`) has
    // none, so recursing with it would leave `color: "border"` unresolved.
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const nestedProperty = tokenCategoryOfProperty(k) !== undefined ? k : property;
      out[k] = resolveTokenValue(v, tokens, nestedProperty);
    }
    return out;
  }
  return value;
}

/**
 * CSS properties whose numeric values are unitless. Every other numeric
 * value is a length and serializes with `px` in emitted CSS text.
 */
const unitlessCssProperties = new Set([
  "animation-iteration-count",
  "aspect-ratio",
  "border-image-outset",
  "border-image-slice",
  "border-image-width",
  "column-count",
  "columns",
  "fill-opacity",
  "flex",
  "flex-grow",
  "flex-negative",
  "flex-order",
  "flex-positive",
  "flex-shrink",
  "flood-opacity",
  "font-size-adjust",
  "font-weight",
  "grid-area",
  "grid-column",
  "grid-column-end",
  "grid-column-start",
  "grid-row",
  "grid-row-end",
  "grid-row-start",
  "initial-letter",
  "line-clamp",
  "-webkit-line-clamp",
  "line-height",
  "opacity",
  "order",
  "orphans",
  "scale",
  "stop-opacity",
  "stroke-miterlimit",
  "stroke-opacity",
  "tab-size",
  "widows",
  "z-index",
  "zoom",
]);

/** True when `property` (camelCase or kebab-case) takes unitless numbers. */
export function isUnitlessCssProperty(property: string): boolean {
  if (property.startsWith("--")) return true;
  const kebab = property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  return unitlessCssProperties.has(kebab.startsWith("webkit-") ? `-${kebab}` : kebab);
}

/**
 * Serialize a static value as CSS text for `property`: numbers become `px`
 * lengths (`padding: 16` → `16px`) except on unitless properties and custom
 * properties (whose type is unknown); `0` stays `0`.
 */
export function cssValueText(property: string, value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value !== 0 && !isUnitlessCssProperty(property)) {
    return `${value}px`;
  }
  return String(value);
}
