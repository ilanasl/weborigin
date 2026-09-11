// The template schema is the heart of the platform.
// A Template describes HOW a banner is built (sizes, layers, fields).
// The data panel is generated automatically from a template's fields.

export type Size = { w: number; h: number };

export type Align = "left" | "center" | "right";

/** How the x/y coordinates anchor an element's box. */
export type Anchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center-left"
  | "center"
  | "center-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

/** A text layer. `key` is also the field name shown in the panel. */
export type TextElement = {
  key: string;
  label: string;
  default: string;
  multiline?: boolean;
  // typography
  size: number; // font size in px (at desktop)
  weight?: number; // 400 / 600 / 700 ...
  color: string;
  align?: Align;
  lineHeight?: number;
  letterSpacing?: number; // px
  uppercase?: boolean;
  // position: x/y are percentages of the banner box (0..100)
  x: number;
  y: number;
  anchor?: Anchor; // default "top-left"
  maxWidthPct?: number; // max text-box width as % of banner width
  hiddenMobile?: boolean; // drop this element on the mobile variant
  // per-size overrides for the mobile variant
  mobile?: Partial<
    Pick<
      TextElement,
      | "size"
      | "weight"
      | "align"
      | "x"
      | "y"
      | "anchor"
      | "maxWidthPct"
      | "lineHeight"
      | "color"
    >
  >;
};

/** A darkening / color wash over (part of) the image, to keep text readable. */
export type Overlay = {
  color: string; // hex
  opacity: number; // 0..1
  gradient?: boolean; // fade instead of a flat wash
  coverage?: "full" | "left" | "right" | "top" | "bottom";
  // For gradients: keep the color solid up to this % before it fades to clear
  // (e.g. a white card that stays solid on the left, then reveals the photo).
  hold?: number; // 0..100, default 0
};

export type LogoSpec = {
  enabled: boolean;
  source: "fixed" | "upload"; // fixed = file in /public, upload = user picks each time
  fixedUrl?: string;
  x: number; // % of box
  y: number;
  widthPct: number; // logo width as % of banner width
  anchor?: Anchor;
  mobile?: Partial<Pick<LogoSpec, "x" | "y" | "widthPct" | "anchor">>;
};

export type BackgroundSpec = {
  mode: "ai" | "upload" | "color";
  defaultTopic?: string; // seed prompt/topic for AI mode
  color?: string; // used for "color" mode or as a fallback
  // CSS object-position for the image (e.g. "right center" keeps the subject
  // on the right visible while an overlay darkens the opposite side).
  position?: string;
  positionMobile?: string;
};

export type Template = {
  id: string;
  name: string;
  description?: string;
  sizes: { desktop: Size; mobile: Size };
  defaultFont: string; // a Google Fonts family name
  background: BackgroundSpec;
  overlay?: Overlay;
  // Optional: a completely separate overlay for the mobile variant (e.g. a
  // white left-fade for a light "card" layout vs. a dark wash on desktop).
  // When present it is used as-is on mobile; the live panel color/opacity apply
  // to the desktop overlay only.
  overlayMobile?: Overlay;
  logo?: LogoSpec;
  elements: TextElement[];
};

/** The values a user fills in for one banner instance. */
export type BannerValues = {
  texts: Record<string, string>; // keyed by element.key
  topic: string; // AI image topic
  backgroundImage?: string; // data URL (generated or uploaded)
  logoImage?: string; // data URL (uploaded logo)
  overlayColor: string;
  overlayOpacity: number;
  fontFamily: string; // chosen Google font (overrides template default)
};

export type SizeKey = "desktop" | "mobile";

/** Merge an element's base props with its mobile overrides for a given size. */
export function resolveElement(el: TextElement, size: SizeKey): TextElement {
  if (size === "desktop" || !el.mobile) return el;
  return { ...el, ...el.mobile };
}

export function resolveLogo(logo: LogoSpec, size: SizeKey): LogoSpec {
  if (size === "desktop" || !logo.mobile) return logo;
  return { ...logo, ...logo.mobile };
}

/** Build default values for a template (used when a template is first opened). */
export function defaultValues(t: Template): BannerValues {
  const texts: Record<string, string> = {};
  for (const el of t.elements) texts[el.key] = el.default;
  return {
    texts,
    topic: t.background.defaultTopic ?? "",
    backgroundImage: undefined,
    logoImage: undefined,
    overlayColor: t.overlay?.color ?? "#000000",
    overlayOpacity: t.overlay?.opacity ?? 0.35,
    fontFamily: t.defaultFont,
  };
}
