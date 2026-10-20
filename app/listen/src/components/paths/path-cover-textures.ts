/**
 * Cover bitmaps for the WebGL transition. Covers are fetched as blobs (same CORS path as every
 * API call) so textures are never tainted, unlike cross-origin <img> elements.
 */
export type CoverLoader = (url: string) => Promise<ImageBitmap | null>;
export const COVER_TEXTURE_SIZE = 512;

async function decodeSource(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch {
    // Chromium cannot decode SVG blobs directly (review fixtures): go through an image element.
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return await createImageBitmap(image);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Centre-cropped square bitmap at texture size. */
export async function decodeCoverBitmap(
  blob: Blob,
  size = COVER_TEXTURE_SIZE,
): Promise<ImageBitmap> {
  const source = await decodeSource(blob);
  const side = Math.min(source.width, source.height);
  try {
    return await createImageBitmap(
      source,
      (source.width - side) / 2,
      (source.height - side) / 2,
      side,
      side,
      { resizeWidth: size, resizeHeight: size, resizeQuality: "high" },
    );
  } finally {
    source.close();
  }
}

export function createCoverLoader(
  resolveUrl: (url: string) => Promise<string> | string,
  credentials: RequestCredentials,
  request: typeof fetch = fetch,
): CoverLoader {
  return async (url) => {
    try {
      const response = await request(await resolveUrl(url), { credentials });
      return response.ok
        ? await decodeCoverBitmap(await response.blob())
        : null;
    } catch {
      return null;
    }
  };
}

interface CacheEntry {
  promise: Promise<ImageBitmap | null>;
  bitmap?: ImageBitmap | null;
}

/** Small LRU of decoded covers; evicted bitmaps are closed to release their memory. */
export class CoverBitmapCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly load: CoverLoader,
    private readonly limit = 8,
  ) {}

  /** Decoded bitmap, or `undefined` while pending, never requested or after a failed load. */
  peek(url: string): ImageBitmap | undefined {
    return this.entries.get(url)?.bitmap ?? undefined;
  }

  request(url: string): Promise<ImageBitmap | null> {
    const existing = this.entries.get(url);
    if (existing) {
      this.entries.delete(url);
      this.entries.set(url, existing);
      return existing.promise;
    }
    const entry: CacheEntry = {
      promise: this.load(url)
        .catch(() => null)
        .then((bitmap) => {
          if (this.entries.get(url) !== entry) {
            bitmap?.close();
            return null;
          }
          // Failures are not cached: an offline blip or expired ticket retries next time.
          if (!bitmap) this.entries.delete(url);
          else entry.bitmap = bitmap;
          return bitmap;
        }),
    };
    this.entries.set(url, entry);
    for (const [key, oldest] of this.entries) {
      if (this.entries.size <= this.limit) break;
      this.entries.delete(key);
      oldest.bitmap?.close();
    }
    return entry.promise;
  }

  clear() {
    for (const entry of this.entries.values()) entry.bitmap?.close();
    this.entries.clear();
  }
}

/** Saturation-weighted mean colour of RGBA pixels, as a CSS colour. */
export function dominantColorFromPixels(data: Uint8ClampedArray): string {
  let r = 0,
    g = 0,
    b = 0,
    total = 0;
  for (let i = 0; i < data.length; i += 4) {
    const max = Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
    const min = Math.min(data[i]!, data[i + 1]!, data[i + 2]!);
    const weight = 0.05 + ((max - min) / 255) * (max / 255);
    r += data[i]! * weight;
    g += data[i + 1]! * weight;
    b += data[i + 2]! * weight;
    total += weight;
  }
  if (!total) return "transparent";
  return `rgb(${Math.round(r / total)} ${Math.round(g / total)} ${Math.round(b / total)})`;
}

export function dominantCoverColor(bitmap: ImageBitmap): string | null {
  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, size, size);
  return dominantColorFromPixels(context.getImageData(0, 0, size, size).data);
}
