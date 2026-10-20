/** Test-only runtime harness: served by Listen's Vite, isolated browser context, intercepted API. */
import { createRoot, type Root } from "react-dom/client";
import { CrateImage } from "../../../app/listen/src/components/artwork/CrateImage";
import {
  cacheOfflineArtwork,
  readOfflineArtwork,
} from "../../../app/listen/src/lib/offline-artwork";
import {
  getOfflineCacheName,
  setActiveOfflineProfileKey,
} from "../../../app/listen/src/lib/offline-storage";
const profile = "playwright-offline-artwork-1bd";
let root: Root | undefined;
export async function saveProofCover() {
  setActiveOfflineProfileKey(profile);
  await cacheOfflineArtwork(profile, [
    { key: "artwork:album:7", path: "/api/albums/7/cover" },
  ]);
}
export function showProofCover() {
  setActiveOfflineProfileKey(profile);
  const element = document.createElement("section");
  element.setAttribute("aria-label", "Offline artwork proof");
  document.body.append(element);
  root = createRoot(element);
  root.render(
    <CrateImage
      src="/api/albums/7/cover?size=128"
      srcSet="/api/albums/7/cover?size=64 64w, /api/albums/7/cover?size=128 128w"
      alt="Persisted offline cover"
    />,
  );
}
export async function clearProofCover() {
  root?.unmount();
  setActiveOfflineProfileKey(null);
  await caches.delete(getOfflineCacheName(profile));
}

export async function hasProofCover() {
  const local = await readOfflineArtwork(profile, {
    key: "artwork:album:7",
    path: "/api/albums/7/cover",
  });
  local?.release();
  return Boolean(local);
}
export async function seedBrokenPersistedCover() {
  setActiveOfflineProfileKey(profile);
  await (
    await caches.open(getOfflineCacheName(profile))
  ).put(
    "/api/albums/7/cover",
    new Response("not an image", { headers: { "content-type": "image/png" } }),
  );
}
