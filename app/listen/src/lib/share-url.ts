import { getApiBase } from "@/lib/api";
import { usesConfigurableServer } from "@/lib/platform";

export function publicShareOrigin() {
  if (typeof window === "undefined") return "";
  if (!usesConfigurableServer) return window.location.origin;
  try {
    const url = new URL(getApiBase() || window.location.origin);
    if (url.hostname.startsWith("api.")) {
      url.hostname = `listen.${url.hostname.slice(4)}`;
    }
    return url.origin;
  } catch {
    return window.location.origin;
  }
}

export function publicShareUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${publicShareOrigin()}${normalizedPath}`;
}

export function publicCrateAlbumCoverUrl(
  crateId: string,
  globalAlbumUid: string,
  size = 512,
) {
  return `${getApiBase()}/share/image/crate/${encodeURIComponent(
    crateId,
  )}/album/${encodeURIComponent(globalAlbumUid)}?size=${size}`;
}

export function publicCrateShareImageUrl(crateId: string) {
  return `${getApiBase()}/share/image/crate/${encodeURIComponent(crateId)}`;
}

export function inviteShareUrl(invite: {
  join_url: string;
  public_url?: string | null;
}) {
  return publicShareUrl(invite.public_url ?? invite.join_url);
}
