import { forwardRef } from "react";
import type React from "react";
import {
  type Anchor,
  type BannerValues,
  type SizeKey,
  type Template,
  resolveElement,
  resolveLogo,
} from "../templates/schema";

function anchorTransform(anchor: Anchor = "top-left"): string {
  const [v, h] = anchor.split("-"); // e.g. "center-left" -> ["center","left"]
  const map: Record<string, string> = { left: "0", center: "-50%", right: "-100%", top: "0", bottom: "-100%" };
  // Special case single-word "center"
  if (anchor === "center") return "translate(-50%, -50%)";
  const tx = map[h ?? "left"] ?? "0";
  const ty = map[v ?? "top"] ?? "0";
  return `translate(${tx}, ${ty})`;
}

function overlayStyle(
  t: Template,
  color: string,
  opacity: number,
  size: SizeKey
): React.CSSProperties | null {
  // Mobile can define a completely separate overlay (its own color/opacity);
  // desktop uses the live panel color/opacity with the template's shape.
  const mobileOv = size === "mobile" ? t.overlayMobile : undefined;
  const ov = mobileOv ?? t.overlay;
  if (!ov) return null;
  const c = mobileOv ? mobileOv.color : color;
  const o = mobileOv ? mobileOv.opacity : opacity;
  const coverage = ov.coverage ?? "full";
  if (ov.gradient) {
    const dir =
      coverage === "left"
        ? "to right"
        : coverage === "right"
        ? "to left"
        : coverage === "top"
        ? "to bottom"
        : "to top";
    const hold = Math.max(0, Math.min(100, ov.hold ?? 0));
    return {
      background: `linear-gradient(${dir}, ${hexA(c, o)} 0%, ${hexA(
        c,
        o
      )} ${hold}%, ${hexA(c, 0)} 100%)`,
    };
  }
  return { background: hexA(c, o) };
}

/** hex + alpha (0..1) -> rgba() */
function hexA(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.replace("#", ""));
  if (!m) return `rgba(0,0,0,${a})`;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

type Props = {
  template: Template;
  values: BannerValues;
  size: SizeKey;
  showText?: boolean; // when false, render image + overlay only (clean banner)
};

/**
 * Renders a banner at its EXACT pixel size. Callers scale the on-screen
 * preview with a CSS transform on a wrapper; this node stays full-size so the
 * exported PNG matches the template dimensions.
 */
export const BannerCanvas = forwardRef<HTMLDivElement, Props>(
  ({ template, values, size, showText = true }, ref) => {
    const dims = template.sizes[size];
    const font = values.fontFamily || template.defaultFont;
    const ov = overlayStyle(
      template,
      values.overlayColor,
      values.overlayOpacity,
      size
    );
    const logo = template.logo?.enabled ? resolveLogo(template.logo, size) : null;
    const logoSrc =
      logo?.source === "upload" ? values.logoImage : logo?.fixedUrl;

    return (
      <div
        ref={ref}
        style={{
          position: "relative",
          width: dims.w,
          height: dims.h,
          overflow: "hidden",
          fontFamily: `"${font}", system-ui, sans-serif`,
          background: template.background.color ?? "#1a1a1a",
          direction: "ltr",
        }}
      >
        {/* Background image */}
        {values.backgroundImage && (
          <img
            src={values.backgroundImage}
            alt=""
            crossOrigin="anonymous"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition:
                (size === "mobile"
                  ? template.background.positionMobile
                  : template.background.position) ?? "center",
            }}
          />
        )}

        {/* Color / gradient overlay for readability */}
        {ov && <div style={{ position: "absolute", inset: 0, ...ov }} />}

        {/* Logo */}
        {logo && logoSrc && (
          <img
            src={logoSrc}
            alt="logo"
            crossOrigin="anonymous"
            style={{
              position: "absolute",
              left: `${logo.x}%`,
              top: `${logo.y}%`,
              width: `${logo.widthPct}%`,
              transform: anchorTransform(logo.anchor),
              objectFit: "contain",
            }}
          />
        )}

        {/* Text elements (illustration only — can be hidden for a clean export) */}
        {showText &&
          template.elements
            .filter((raw) => !(size === "mobile" && raw.hiddenMobile))
            .map((raw) => {
          const el = resolveElement(raw, size);
          const text = values.texts[el.key] ?? el.default;
          const isButton = el.key === "cta";
          return (
            <div
              key={el.key}
              style={{
                position: "absolute",
                left: `${el.x}%`,
                top: `${el.y}%`,
                transform: anchorTransform(el.anchor),
                maxWidth: el.maxWidthPct ? `${el.maxWidthPct}%` : undefined,
                fontSize: el.size,
                fontWeight: el.weight ?? 400,
                color: el.color,
                textAlign: el.align ?? "left",
                lineHeight: el.lineHeight ?? 1.15,
                letterSpacing: el.letterSpacing ? `${el.letterSpacing}px` : undefined,
                textTransform: el.uppercase ? "uppercase" : "none",
                whiteSpace: raw.multiline ? "pre-line" : "normal",
                ...(isButton
                  ? {
                      background: "#ffffff",
                      padding: `${Math.round(el.size * 0.55)}px ${Math.round(
                        el.size * 1.1
                      )}px`,
                      borderRadius: 999,
                      display: "inline-block",
                    }
                  : {}),
              }}
            >
              {text}
            </div>
          );
        })}
      </div>
    );
  }
);

BannerCanvas.displayName = "BannerCanvas";
