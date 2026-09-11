import { useEffect, useRef } from "react";
import type { SizeKey, Template } from "../templates/schema";
import { renderBanner } from "../lib/render";
import { ensureFontReady } from "../lib/fonts";
import { loadImage } from "../lib/images";

type Props = {
  template: Template;
  size: SizeKey;
  imageSrc?: string | null; // data/object URL; null → placeholder
  logoSrc?: string | null;
  texts?: Record<string, string>;
  showText?: boolean;
};

/** Renders a banner into a scaled <canvas> (fits the card width). */
export function BannerThumb({ template, size, imageSrc, logoSrc, texts = {}, showText = false }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    let img: HTMLImageElement | null = null;
    let logo: HTMLImageElement | null = null;
    const draw = () => {
      if (cancelled) return;
      const src = renderBanner({ template, size, image: img, logo, texts, showText });
      const dst = ref.current;
      if (!dst) return;
      dst.width = src.width;
      dst.height = src.height;
      dst.getContext("2d")!.drawImage(src, 0, 0);
    };
    // Draw immediately (placeholder + fallback font), then refine.
    draw();
    ensureFontReady(template.defaultFont).then(draw).catch(() => {});
    if (imageSrc) {
      loadImage(imageSrc).then((loaded) => { if (!cancelled) { img = loaded; draw(); } }).catch(() => {});
    }
    if (logoSrc) {
      loadImage(logoSrc).then((loaded) => { if (!cancelled) { logo = loaded; draw(); } }).catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [template, size, imageSrc, logoSrc, texts, showText]);

  return <canvas ref={ref} className="thumb-canvas" />;
}
