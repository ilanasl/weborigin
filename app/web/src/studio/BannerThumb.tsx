import { useEffect, useRef } from "react";
import type { SizeKey, Template } from "../templates/schema";
import { renderBanner } from "../lib/render";
import { ensureFontReady } from "../lib/fonts";

type Props = {
  template: Template;
  size: SizeKey;
  image: HTMLImageElement | null;
  texts?: Record<string, string>;
  showText?: boolean;
};

/** Renders a banner into a scaled <canvas> (fits the card width). */
export function BannerThumb({ template, size, image, texts = {}, showText = false }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    const draw = () => {
      if (cancelled) return;
      const src = renderBanner({ template, size, image, texts, showText });
      const dst = ref.current;
      if (!dst) return;
      dst.width = src.width;
      dst.height = src.height;
      dst.getContext("2d")!.drawImage(src, 0, 0);
    };
    // Draw immediately (fallback font), then redraw once the web font is ready.
    draw();
    ensureFontReady(template.defaultFont).then(draw).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [template, size, image, texts, showText]);

  return <canvas ref={ref} className="thumb-canvas" />;
}
