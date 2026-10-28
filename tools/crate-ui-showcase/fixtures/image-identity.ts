import crateMarkUrl from "../../design-system-preview/public/assets/logo.svg?url";
export const CRATE_MARK_URL = crateMarkUrl;
/** Deterministic artwork fixtures: no network, user data or transport credentials. */
function artwork(background: string, accent: string): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><rect width="320" height="320" fill="${background}"/><circle cx="160" cy="160" r="104" fill="none" stroke="${accent}" stroke-width="2"/><path d="M32 208L160 80l128 128M32 240h256" fill="none" stroke="${accent}" stroke-width="16"/></svg>`)}`;
}
export const IMAGE_SAMPLES = [
  artwork("#12343b", "#59e3f4"),
  artwork("#283650", "#a8bccd"),
  artwork("#314228", "#b9cc91"),
  artwork("#423227", "#d6b48a"),
];
export const IMAGE_TRACKS = [1, 2, 3, 4].map((album_id) => ({ album_id }));
export const sampleCoverUrl = (track: { album_id?: number }) =>
  IMAGE_SAMPLES[(track.album_id ?? 1) - 1] ?? null;
