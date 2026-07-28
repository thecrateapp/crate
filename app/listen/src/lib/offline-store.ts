export function encodeOfflineProfileIdentity(input: string): string {
  try {
    return btoa(unescape(encodeURIComponent(input)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  } catch {
    return encodeURIComponent(input);
  }
}

export function readOfflineStoreItem(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeOfflineStoreItem(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Offline persistence is best-effort; media indexes remain authoritative.
  }
}
