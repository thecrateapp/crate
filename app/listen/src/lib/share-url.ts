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
