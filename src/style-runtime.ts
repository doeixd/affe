import {
  defaultThemeTokens,
  isStructuredTokenLeaf,
  lookupToken,
  type SlotStyle,
  type ThemeTokenSchema,
} from "./style-types.js";

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
const unitlessCssProperties = /*#__PURE__*/ new Set([
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

/** CSS property name for a style key: camelCase to kebab-case, custom properties verbatim. */
export function cssPropertyNameOf(prop: string): string {
  if (prop.startsWith("--") || prop.includes("-")) return prop;
  const kebab = prop.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  return /^(webkit|moz|ms|o)-/.test(kebab) ? `-${kebab}` : kebab;
}

/** Affe style shorthands whose CSS property differs from the style key. */
const shorthandProperty: Readonly<Record<string, string>> = {
  shadow: "box-shadow",
};

function lengthText(value: unknown): string {
  return typeof value === "number" && value !== 0 ? `${value}px` : String(value);
}

function isShadow(value: object): value is { x: number; y: number; blur: number; spread?: number; color?: string } {
  const record = value as Record<string, unknown>;
  return typeof record.x === "number" && typeof record.y === "number";
}

/**
 * Serialize one resolved style entry as the inline CSS declarations an
 * element-backed slot handle writes (DQ-073). `null` text means REMOVE.
 * Meta keys (`_states`, `__nest`, ...) produce nothing: they are selector
 * data, rendered by static extraction, not inline declarations. Structured
 * values expand: a shadow leaf becomes `box-shadow`, a `border` record
 * becomes `border`, and length tuples join with spaces. Other object values
 * have no inline form and are skipped.
 */
export function inlineStyleDeclarations(
  prop: string,
  value: unknown,
): ReadonlyArray<readonly [name: string, text: string | null]> {
  if (prop.startsWith("_")) return [];
  const name = shorthandProperty[prop] ?? cssPropertyNameOf(prop);
  if (value === null || value === undefined || value === false || value === "") {
    return [[name, null]];
  }
  if (Array.isArray(value)) {
    return [[name, value.map((part) => cssValueText(prop, part)).join(" ")]];
  }
  if (typeof value === "object") {
    if (isShadow(value)) {
      const parts = [lengthText(value.x), lengthText(value.y), lengthText(value.blur ?? 0)];
      if (typeof value.spread === "number") parts.push(lengthText(value.spread));
      if (value.color !== undefined) parts.push(String(value.color));
      return [[name, parts.join(" ")]];
    }
    const record = value as Record<string, unknown>;
    if (prop === "border" || prop.startsWith("border")) {
      const width = record.width === undefined ? "1px" : lengthText(record.width);
      const style = record.style === undefined ? "solid" : String(record.style);
      const color = record.color === undefined ? "currentColor" : String(record.color);
      return [[name, `${width} ${style} ${color}`]];
    }
    return [];
  }
  return [[name, cssValueText(prop, value)]];
}
