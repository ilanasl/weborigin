const cache = new Map<string, HTMLImageElement>();

/** Load an image (data URL or object URL) into an HTMLImageElement, cached. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  const hit = cache.get(src);
  if (hit && hit.complete) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      cache.set(src, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error("Could not load image."));
    img.src = src;
  });
}
