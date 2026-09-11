export type ExportFormat = "png" | "jpeg" | "webp";

export const MIME: Record<ExportFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const EXT: Record<ExportFormat, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
};

function toBlob(canvas: HTMLCanvasElement, type: string, q?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), type, q)
  );
}

/** Flatten transparency onto a background (for JPG, which has no alpha). */
function flatten(canvas: HTMLCanvasElement, bg: string): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  return out;
}

export type EncodeOptions = {
  format: ExportFormat;
  targetKB?: number; // JPG/WebP only — tune quality to stay under this
  background?: string; // for JPG flattening
};

/** Encode a canvas to a Blob, tuning quality to a target size when asked. */
export async function encodeCanvas(
  canvas: HTMLCanvasElement,
  opts: EncodeOptions
): Promise<Blob> {
  const type = MIME[opts.format];
  const src = opts.format === "jpeg" ? flatten(canvas, opts.background || "#ffffff") : canvas;

  if (opts.format === "png" || !opts.targetKB) {
    return toBlob(src, type, opts.format === "png" ? undefined : 0.92);
  }

  const target = opts.targetKB * 1024;
  let lo = 0.3;
  let hi = 0.95;
  let best = await toBlob(src, type, hi);
  if (best.size <= target) return best;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    const blob = await toBlob(src, type, mid);
    if (blob.size <= target) {
      best = blob;
      lo = mid;
    } else hi = mid;
  }
  return best;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
