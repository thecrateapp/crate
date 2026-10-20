const listeners = new Set<() => void>();
let generation = 0;
const versions = new Map<string, number>();
const profileVersions = new Map<string, number>();
const networkChanged = () => notifyOfflineArtworkChanged();
/** No-argument notifications are identity/network changes; image writes target one profile/asset. */
export function notifyOfflineArtworkChanged(
  profileKey?: string,
  assetKey?: string,
): void {
  if (!profileKey) generation += 1;
  else if (assetKey) {
    const key = `${profileKey}:${assetKey}`;
    versions.set(key, (versions.get(key) ?? 0) + 1);
  } else
    profileVersions.set(profileKey, (profileVersions.get(profileKey) ?? 0) + 1);
  for (const listener of listeners) listener();
}
export function subscribeOfflineArtwork(listener: () => void): () => void {
  if (!listeners.size && typeof window !== "undefined") {
    window.addEventListener("online", networkChanged);
    window.addEventListener("offline", networkChanged);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && typeof window !== "undefined") {
      window.removeEventListener("online", networkChanged);
      window.removeEventListener("offline", networkChanged);
    }
  };
}
export function offlineArtworkVersion(
  profileKey?: string | null,
  assetKey?: string,
): string {
  return `${generation}:${profileKey ?? ""}:${profileVersions.get(profileKey ?? "") ?? 0}:${versions.get(`${profileKey}:${assetKey}`) ?? 0}`;
}
