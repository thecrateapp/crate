import { isNative } from "@/lib/capacitor-runtime";

import { nativeSocialShare } from "./social-share-native";
import type { CrateStoryStyle } from "./social-share-story-canvas";
import {
  buildInstagramStoryCard,
  withTimeout,
} from "./social-share-story-builder";

export {
  buildInstagramStoryBlob,
  buildSquarePostCard,
  canvasToJpegBlob,
} from "./social-share-story-builder";

export const SHARE_REQUEST_EVENT = "crate:share-request";

const STORY_NATIVE_SHARE_TIMEOUT_MS = 8000;

export type ShareSubjectKind =
  | "track"
  | "album"
  | "artist"
  | "playlist"
  | "crate"
  | "genre"
  | "digging";

export interface CrateShareAlbum {
  imageUrl?: string | null;
  name: string;
  artistName: string;
  position: number;
}

export interface DiggingShareStat {
  value: string;
  label: string;
}

export interface DiggingShareData {
  kicker: string;
  headline: string;
  coverUrls: string[];
  topArtistsLabel: string;
  topArtists: string[];
  topTracksLabel: string;
  topTracks: string[];
  stats: DiggingShareStat[];
  credit: string;
}

export interface SharePayload {
  kind: ShareSubjectKind;
  title: string;
  url: string;
  subtitle?: string | null;
  imageUrl?: string | null;
  crateAlbums?: CrateShareAlbum[];
  crateAlbumCount?: number;
  crateIsOrdered?: boolean;
  crateStoryStyle?: CrateStoryStyle;
  crateOwnerInstagram?: string | null;
  crateOwnerName?: string | null;
  crateSortDirection?: "asc" | "desc";
  crateTrackCount?: number;
  digging?: DiggingShareData;
}

export interface ShareCardLabels {
  subtitle?: string;
  metadata?: string;
  kicker?: string;
  cta?: string;
}

export type ShareImageFormat = "story" | "square";

export type ShareImageResult = "shared" | "downloaded" | "cancelled";

export function buildShareText(payload: SharePayload): string {
  const title = payload.title.trim();
  const subtitle = payload.subtitle?.trim();
  if (!subtitle || subtitle === title) return title;
  return `${title} - ${subtitle}`;
}

export function buildWhatsAppShareUrl(
  payload: SharePayload,
  text = buildShareText(payload),
): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text}\n${payload.url}`)}`;
}

export function buildTelegramShareUrl(
  payload: SharePayload,
  text = buildShareText(payload),
): string {
  const params = new URLSearchParams({
    url: payload.url,
    text,
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
  labels?: ShareCardLabels,
): Promise<void> {
  if (!isNative) {
    throw new Error(
      "Instagram Stories sharing is only available in mobile apps",
    );
  }
  const imageDataUrl = await buildInstagramStoryCard(payload, labels);
  await withTimeout(
    nativeSocialShare.shareInstagramStory({
      imageDataUrl,
      contentUrl: payload.url,
    }),
    STORY_NATIVE_SHARE_TIMEOUT_MS,
    "Instagram Stories did not respond",
  );
}

export function buildShareImageFileName(
  payload: SharePayload,
  format: ShareImageFormat,
): string {
  const slug =
    payload.title
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || payload.kind;
  return `crate-${slug}-${format === "story" ? "story" : "post"}.jpg`;
}

export async function shareImageFile(
  blob: Blob,
  fileName: string,
  options: { title?: string; allowDownload?: boolean } = {},
): Promise<ShareImageResult> {
  const file = new File([blob], fileName, {
    type: blob.type || "image/jpeg",
  });
  const canShareFiles =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] });

  if (canShareFiles) {
    try {
      await navigator.share({ files: [file], title: options.title });
      return "shared";
    } catch (error) {
      const name = (error as Error | null)?.name;
      if (name === "AbortError") return "cancelled";
      if (name !== "NotAllowedError") throw error;
    }
  }

  if (options.allowDownload === false) {
    throw new Error("Sharing image files is not supported on this device");
  }
  downloadBlob(blob, fileName);
  return "downloaded";
}

export function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  }
}
