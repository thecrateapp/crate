import { registerPlugin } from "@capacitor/core";

import { resolveMaybeApiAssetUrl } from "@/lib/api";
import { isNative } from "@/lib/capacitor-runtime";
import { recordDevLog } from "@/lib/dev-logs";

export const SHARE_REQUEST_EVENT = "crate:share-request";

const STORY_WIDTH = 1080;
const STORY_HEIGHT = 1920;
const STORY_ASSET_TIMEOUT_MS = 4500;
const STORY_FONT_TIMEOUT_MS = 1500;
const STORY_NATIVE_SHARE_TIMEOUT_MS = 8000;
const CRATE_LOGO_URL = "/icons/logo.svg";
const POPPINS_600_URL = new URL(
  "../../../shared/fonts/poppins/poppins-600.woff2",
  import.meta.url,
).href;
const POPPINS_800_URL = new URL(
  "../../../shared/fonts/poppins/poppins-800.woff2",
  import.meta.url,
).href;

export type ShareSubjectKind =
  | "track"
  | "album"
  | "artist"
  | "playlist"
  | "genre";

export interface SharePayload {
  kind: ShareSubjectKind;
  title: string;
  url: string;
  subtitle?: string | null;
  imageUrl?: string | null;
}

interface NativeInstagramStoryResult {
  available?: boolean;
  shared?: boolean;
}

interface NativeHttpResponse {
  status: number;
  data?: unknown;
  headers?: Record<string, string>;
}

interface NativeHttpPlugin {
  get(options: {
    url: string;
    responseType: "blob";
    connectTimeout: number;
    readTimeout: number;
  }): Promise<NativeHttpResponse>;
}

interface NativeImageDataResult {
  dataUrl?: string;
}

interface CrateSocialSharePlugin {
  canShareInstagramStory(): Promise<NativeInstagramStoryResult>;
  loadImageDataUrl?(options: { url: string }): Promise<NativeImageDataResult>;
  shareInstagramStory(options: {
    imageDataUrl: string;
    contentUrl: string;
  }): Promise<NativeInstagramStoryResult>;
}

const nativeSocialShare =
  registerPlugin<CrateSocialSharePlugin>("CrateSocialShare");

export function buildShareText(payload: SharePayload): string {
  const title = payload.title.trim();
  const subtitle = payload.subtitle?.trim();
  if (!subtitle || subtitle === title) return title;
  return `${title} - ${subtitle}`;
}

export function buildWhatsAppShareUrl(payload: SharePayload): string {
  return `https://wa.me/?text=${encodeURIComponent(
    `${buildShareText(payload)}\n${payload.url}`,
  )}`;
}

export function buildTelegramShareUrl(payload: SharePayload): string {
  const params = new URLSearchParams({
    url: payload.url,
    text: buildShareText(payload),
  });
  return `https://t.me/share/url?${params.toString()}`;
}

export function openShareSheet(payload: SharePayload): boolean {
  if (typeof window === "undefined") return false;
  window.dispatchEvent(
    new CustomEvent<SharePayload>(SHARE_REQUEST_EVENT, { detail: payload }),
  );
  return true;
}

export function subscribeShareRequests(
  listener: (payload: SharePayload) => void,
): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<SharePayload>).detail);
  };
  window.addEventListener(SHARE_REQUEST_EVENT, handler);
  return () => window.removeEventListener(SHARE_REQUEST_EVENT, handler);
}

export async function canShareInstagramStory(): Promise<boolean> {
  if (!isNative) return false;
  try {
    const result = await nativeSocialShare.canShareInstagramStory();
    return Boolean(result.available);
  } catch {
    return false;
  }
}

export async function shareInstagramStory(
  payload: SharePayload,
): Promise<void> {
  if (!isNative) {
    throw new Error(
      "Instagram Stories sharing is only available in mobile apps",
    );
  }
  const imageDataUrl = await buildInstagramStoryCard(payload);
  await withTimeout(
    nativeSocialShare.shareInstagramStory({
      imageDataUrl,
      contentUrl: payload.url,
    }),
    STORY_NATIVE_SHARE_TIMEOUT_MS,
    "Instagram Stories did not respond",
  );
}

async function buildInstagramStoryCard(payload: SharePayload): Promise<string> {
  await withTimeout(
    loadInstagramStoryFonts(),
    STORY_FONT_TIMEOUT_MS,
    "Story font loading timed out",
  ).catch((error) => {
    recordDevLog(
      "share",
      "Instagram story fonts unavailable; using fallback fonts",
      { error: formatArtworkError(error) },
      "warn",
    );
  });

  const canvas = document.createElement("canvas");
  canvas.width = STORY_WIDTH;
  canvas.height = STORY_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");

  const [artwork, logo] = await Promise.all([
    payload.imageUrl
      ? loadOptionalCanvasImage(payload.imageUrl, "artwork")
      : Promise.resolve(null),
    loadOptionalCanvasImage(CRATE_LOGO_URL, "logo"),
  ]);
  try {
    if (artwork) {
      drawStoryArtworkBackground(
        ctx,
        artwork.image,
        canvas.width,
        canvas.height,
      );
    } else {
      drawStoryBackground(ctx, canvas.width, canvas.height);
    }

    drawStoryBrand(ctx, logo?.image ?? null);
    drawEditorialStoryCard(
      ctx,
      payload,
      artwork?.image ?? null,
      logo?.image ?? null,
    );

    return canvas.toDataURL("image/jpeg", 0.94);
  } finally {
    artwork?.release();
    logo?.release();
  }
}

let storyFontsPromise: Promise<void> | null = null;

async function loadInstagramStoryFonts(): Promise<void> {
  if (typeof FontFace === "undefined" || !document.fonts) return;
  storyFontsPromise ??= Promise.all([
    loadFontFace("Poppins", POPPINS_600_URL, "600"),
    loadFontFace("Poppins", POPPINS_800_URL, "800"),
  ]).then(() => undefined);
  await storyFontsPromise;
}

async function loadFontFace(
  family: string,
  url: string,
  weight: string,
): Promise<void> {
  const face = new FontFace(family, `url(${url})`, {
    style: "normal",
    weight,
  });
  const loaded = await face.load();
  document.fonts.add(loaded);
}

function drawStoryArtworkBackground(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
) {
  ctx.fillStyle = "#020304";
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.filter = "blur(10px) saturate(1.06)";
  drawCoverImage(ctx, image, -44, -44, width + 88, height + 88, {
    alpha: 0.62,
  });
  ctx.restore();

  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fillRect(0, 0, width, height);

  const vignette = ctx.createRadialGradient(540, 840, 120, 540, 960, 1120);
  vignette.addColorStop(0, "rgba(0,0,0,0.04)");
  vignette.addColorStop(0.58, "rgba(0,0,0,0.34)");
  vignette.addColorStop(1, "rgba(0,0,0,0.88)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  const shade = ctx.createLinearGradient(0, 0, 0, height);
  shade.addColorStop(0, "rgba(0,0,0,0.2)");
  shade.addColorStop(0.68, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.74)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);
}

function drawEditorialStoryCard(
  ctx: CanvasRenderingContext2D,
  payload: SharePayload,
  artwork: HTMLImageElement | null,
  logo: HTMLImageElement | null,
) {
  const cardWidth = 840;
  const cardX = (STORY_WIDTH - cardWidth) / 2;
  const cardY = 468;
  const padding = 28;
  const artSize = cardWidth - padding * 2;
  const artX = cardX + padding;
  const artY = cardY + padding;
  const infoY = artY + artSize;
  const infoHeight = 346;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.68)";
  ctx.shadowBlur = 84;
  ctx.shadowOffsetY = 42;
  ctx.fillStyle = "#f8fafc";
  roundedRect(ctx, cardX, cardY, cardWidth, padding + artSize + infoHeight, 18);
  ctx.fill();
  ctx.restore();

  if (artwork) {
    ctx.save();
    roundedRect(ctx, artX, artY, artSize, artSize, 4);
    ctx.clip();
    drawCoverImage(ctx, artwork, artX, artY, artSize, artSize);
    ctx.restore();
  } else {
    drawGeneratedStoryArtwork(ctx, payload, artX, artY, artSize, logo);
  }

  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(artX, infoY, artSize, infoHeight - padding);

  ctx.textAlign = "center";
  ctx.fillStyle = "#111318";
  ctx.font = "800 76px Poppins, ui-sans-serif, system-ui";
  drawWrappedText(
    ctx,
    payload.title.toUpperCase(),
    STORY_WIDTH / 2,
    infoY + 128,
    cardWidth - 128,
    82,
    2,
  );

  ctx.fillStyle = "#62636d";
  ctx.font = "800 43px Poppins, ui-sans-serif, system-ui";
  drawWrappedText(
    ctx,
    buildInstagramStorySubtitle(payload),
    STORY_WIDTH / 2,
    infoY + 266,
    cardWidth - 144,
    52,
    2,
  );
}

function drawGeneratedStoryArtwork(
  ctx: CanvasRenderingContext2D,
  payload: SharePayload,
  x: number,
  y: number,
  size: number,
  logo: HTMLImageElement | null,
) {
  ctx.save();
  roundedRect(ctx, x, y, size, size, 4);
  ctx.clip();

  const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, "#092f36");
  gradient.addColorStop(0.48, "#10131a");
  gradient.addColorStop(1, "#020306");
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, size, size);

  const glow = ctx.createRadialGradient(
    x + size * 0.28,
    y + size * 0.16,
    10,
    x + size * 0.28,
    y + size * 0.16,
    size * 0.86,
  );
  glow.addColorStop(0, "rgba(34,211,238,0.46)");
  glow.addColorStop(1, "rgba(34,211,238,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, size, size);

  if (logo) drawLogoImage(ctx, logo, x + size * 0.34, y + size * 0.16, 240);

  ctx.fillStyle = "rgba(248,250,252,0.08)";
  ctx.font = "800 230px Poppins, ui-sans-serif, system-ui";
  ctx.textAlign = "center";
  ctx.fillText(getStoryInitials(payload.title), x + size / 2, y + size * 0.84);

  ctx.restore();
}

function drawStoryBrand(
  ctx: CanvasRenderingContext2D,
  logo: HTMLImageElement | null,
) {
  if (logo) drawLogoImage(ctx, logo, 120, 380, 72);
  ctx.textAlign = "left";
  ctx.fillStyle = "#f8fafc";
  ctx.font = "800 44px Poppins, ui-sans-serif, system-ui";
  ctx.letterSpacing = "10px";
  ctx.fillText("CRATE", 214, 433);
  ctx.letterSpacing = "0px";
}

function buildInstagramStorySubtitle(payload: SharePayload): string {
  const subtitle = payload.subtitle?.trim();
  if (!subtitle) {
    if (payload.kind === "artist") return "Artist";
    return "From Crate";
  }
  if (payload.kind === "track") return `Track by ${subtitle}`;
  if (payload.kind === "album") return `Album by ${subtitle}`;
  if (payload.kind === "playlist") return `Playlist by ${subtitle}`;
  return subtitle;
}

function getStoryInitials(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function drawLogoImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
) {
  const height = width * (image.naturalHeight / image.naturalWidth);
  ctx.drawImage(image, x, y, width, height);
}

function drawStoryBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#071013");
  gradient.addColorStop(0.44, "#0b0c12");
  gradient.addColorStop(1, "#030407");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const cyan = ctx.createRadialGradient(170, 120, 20, 170, 120, 900);
  cyan.addColorStop(0, "rgba(34,211,238,0.42)");
  cyan.addColorStop(1, "rgba(34,211,238,0)");
  ctx.fillStyle = cyan;
  ctx.fillRect(0, 0, width, height);

  const lime = ctx.createRadialGradient(900, 1780, 20, 900, 1780, 760);
  lime.addColorStop(0, "rgba(214,255,99,0.2)");
  lime.addColorStop(1, "rgba(214,255,99,0)");
  ctx.fillStyle = lime;
  ctx.fillRect(0, 0, width, height);
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  options: { alpha?: number } = {},
) {
  const scale = Math.max(
    width / image.naturalWidth,
    height / image.naturalHeight,
  );
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (image.naturalWidth - sourceWidth) / 2;
  const sourceY = (image.naturalHeight - sourceHeight) / 2;
  ctx.save();
  ctx.globalAlpha = options.alpha ?? 1;
  ctx.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height,
  );
  ctx.restore();
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = 3,
) {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth || !line) {
      line = test;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines || words.join(" ") !== visible.join(" ")) {
    const last = visible[visible.length - 1] || "";
    visible[visible.length - 1] = `${last.replace(/[.,;:!?-]+$/, "")}...`;
  }
  visible.forEach((value, index) => {
    ctx.fillText(value, x, y + index * lineHeight);
  });
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

interface CanvasArtwork {
  image: HTMLImageElement;
  release: () => void;
}

async function loadOptionalCanvasImage(
  src: string,
  label: string,
): Promise<CanvasArtwork | null> {
  try {
    return await withTimeout(
      loadCanvasImage(src),
      STORY_ASSET_TIMEOUT_MS,
      `${label} loading timed out`,
    );
  } catch (error) {
    recordDevLog(
      "share",
      `Instagram story ${label} unavailable; using fallback`,
      { error: formatArtworkError(error), src },
      "warn",
    );
    return null;
  }
}

async function loadCanvasImage(src: string): Promise<CanvasArtwork> {
  const resolvedSrc = resolveMaybeApiAssetUrl(src) || src;
  if (isNative && isHttpUrl(resolvedSrc)) {
    const dataUrl = await loadNativeHttpImageDataUrl(resolvedSrc);
    const image = await loadImageElement(dataUrl);
    return {
      image,
      release: () => undefined,
    };
  }

  let response: Response;
  try {
    response = await fetch(resolvedSrc, { credentials: "same-origin" });
  } catch (error) {
    throw new Error(
      `Failed to load share artwork: ${formatArtworkError(error)}`,
    );
  }
  if (!response.ok) {
    throw new Error(`Failed to load share artwork: HTTP ${response.status}`);
  }
  const blob = await response.blob();
  if (blob.type && !blob.type.startsWith("image/")) {
    throw new Error(`Failed to load share artwork: unexpected ${blob.type}`);
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImageElement(objectUrl);
    return {
      image,
      release: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function loadNativeHttpImageDataUrl(src: string): Promise<string> {
  const pluginDataUrl = await loadNativeSharePluginImageDataUrl(src).catch(
    (error) => {
      recordDevLog(
        "share",
        "Native story artwork loader failed; falling back to CapacitorHttp",
        { error: formatArtworkError(error), src },
        "warn",
      );
      return null;
    },
  );
  if (pluginDataUrl) return pluginDataUrl;

  let response;
  try {
    const nativeHttp = await getNativeHttpPlugin();
    if (!nativeHttp) {
      throw new Error("native HTTP plugin is not available");
    }
    response = await nativeHttp.get({
      url: src,
      responseType: "blob",
      connectTimeout: 15_000,
      readTimeout: 30_000,
    });
  } catch (error) {
    throw new Error(
      `Failed to load share artwork: ${formatArtworkError(error)}`,
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Failed to load share artwork: HTTP ${response.status}`);
  }

  const base64 = typeof response.data === "string" ? response.data.trim() : "";
  if (!base64) {
    throw new Error("Failed to load share artwork: empty response");
  }
  if (base64.startsWith("data:image/")) return base64;

  const contentType =
    getResponseHeader(response.headers, "content-type")
      ?.split(";")[0]
      ?.trim() ||
    inferImageMimeFromBase64(base64) ||
    inferImageMimeFromUrl(src);
  return `data:${contentType};base64,${base64}`;
}

async function loadNativeSharePluginImageDataUrl(
  src: string,
): Promise<string | null> {
  if (!nativeSocialShare.loadImageDataUrl) return null;
  const result = await nativeSocialShare.loadImageDataUrl({ url: src });
  const dataUrl = result.dataUrl?.trim();
  if (!dataUrl) {
    throw new Error("native social image loader returned empty data");
  }
  if (!dataUrl.startsWith("data:image/")) {
    throw new Error("native social image loader returned non-image data");
  }
  return dataUrl;
}

let nativeHttpPluginPromise: Promise<NativeHttpPlugin | null> | null = null;

function getNativeHttpPlugin(): Promise<NativeHttpPlugin | null> {
  nativeHttpPluginPromise ??= import("@capacitor/core")
    .then((module) => {
      const maybeModule = module as unknown as {
        Capacitor?: {
          Plugins?: {
            CapacitorHttp?: NativeHttpPlugin;
          };
        };
        CapacitorHttp?: NativeHttpPlugin;
      };
      return (
        maybeModule.CapacitorHttp ??
        maybeModule.Capacitor?.Plugins?.CapacitorHttp ??
        null
      );
    })
    .catch(() => getWindowCapacitorHttpPlugin());
  return nativeHttpPluginPromise;
}

function getWindowCapacitorHttpPlugin(): NativeHttpPlugin | null {
  if (typeof window === "undefined") return null;
  const maybeWindow = window as unknown as {
    Capacitor?: {
      Plugins?: {
        CapacitorHttp?: NativeHttpPlugin;
      };
    };
  };
  return maybeWindow.Capacitor?.Plugins?.CapacitorHttp ?? null;
}

function getResponseHeader(
  headers: Record<string, string> | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return null;
}

function inferImageMimeFromUrl(src: string): string {
  const pathname = safeUrlPathname(src).toLowerCase();
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg"))
    return "image/jpeg";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".gif")) return "image/gif";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  return "image/png";
}

function inferImageMimeFromBase64(base64: string): string | null {
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("iVBORw0KGgo")) return "image/png";
  if (base64.startsWith("UklGR")) return "image/webp";
  if (base64.startsWith("R0lGOD")) return "image/gif";
  if (base64.startsWith("PHN2Zy") || base64.startsWith("PD94bW")) {
    return "image/svg+xml";
  }
  return null;
}

function safeUrlPathname(src: string): string {
  try {
    return new URL(src).pathname;
  } catch {
    return src.split("?")[0] || "";
  }
}

function isHttpUrl(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load share artwork"));
    image.src = src;
  });
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId: number | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId != null) window.clearTimeout(timeoutId);
  });
}

function formatArtworkError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "network error";
}
