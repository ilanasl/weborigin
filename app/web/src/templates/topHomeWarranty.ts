import type { Template } from "./schema";

// Reproduces the live hero banner from tophomewarrantyservices.com:
// a wide house/family photo with a dark navy wash fading from the left,
// white headline + subtitle + "Last Updated" line, and an advertising
// disclosure bottom-right. The image TOPIC is a field you change per banner;
// the headline/subtitle texts are editable too.
//
// NOTE: exact pixel size and the navy hex are best-effort estimates from the
// screenshots (the live site could not be fetched). Adjust `sizes.desktop`
// and the overlay `color` below to match the real values when known.
export const topHomeWarranty: Template = {
  id: "top-home-warranty",
  name: "Home Warranty Hero",
  description: "Wide photo hero with a navy left-fade overlay and white text.",
  sizes: {
    desktop: { w: 1900, h: 260 },
    mobile: { w: 375, h: 320 },
  },
  defaultFont: "Open Sans",
  background: {
    mode: "ai",
    defaultTopic:
      "a happy family in front of a suburban home with a garage, bright natural daylight, lifestyle photography",
    // Match the live site: keep the subject on the right, overlay darkens the left.
    position: "right center",
    positionMobile: "center",
  },
  // Desktop: dark navy, opaque on the left, fading to clear on the right.
  overlay: {
    color: "#0e2a3f",
    opacity: 0.82,
    gradient: true,
    coverage: "left",
  },
  // Mobile (inferred): same photo, dark gradient rising from the bottom so the
  // stacked white text stays readable.
  overlayMobile: { coverage: "bottom", gradient: true },
  logo: { enabled: false, source: "upload", x: 0, y: 0, widthPct: 0 },
  elements: [
    {
      key: "headline",
      label: "Headline",
      default: "Top Home Warranty Companies 2026",
      size: 46,
      weight: 800,
      color: "#ffffff",
      align: "left",
      x: 15.5,
      y: 26,
      anchor: "top-left",
      maxWidthPct: 52,
      lineHeight: 1.05,
      mobile: { size: 30, x: 6, y: 40, maxWidthPct: 88, lineHeight: 1.1 },
    },
    {
      key: "subtitle",
      label: "Subtitle",
      default:
        "Be prepared for the unexpected and avoid unnecessary expenses. Compare 2026's top home warranty companies and keep your systems running as it should.",
      multiline: false,
      size: 21,
      weight: 400,
      color: "#e8eef4",
      align: "left",
      x: 15.5,
      y: 48,
      anchor: "top-left",
      maxWidthPct: 47,
      lineHeight: 1.3,
      mobile: { size: 15, x: 6, y: 64, maxWidthPct: 90 },
    },
    {
      key: "lastUpdated",
      label: "Last updated line",
      default: "✓ Last Updated: September 2026",
      size: 16,
      weight: 400,
      color: "#ffffff",
      align: "left",
      x: 15.5,
      y: 86,
      anchor: "top-left",
      mobile: { size: 13, x: 6, y: 90 },
    },
    {
      key: "disclosure",
      label: "Advertising disclosure",
      default: "Advertising Disclosure",
      size: 13,
      weight: 400,
      color: "#d7dee6",
      align: "right",
      x: 98,
      y: 92,
      anchor: "bottom-right",
      mobile: { x: 94, y: 8, anchor: "top-right", size: 11 },
    },
  ],
};
