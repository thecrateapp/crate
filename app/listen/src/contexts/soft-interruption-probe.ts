import { getStreamUrl } from "@/contexts/player-utils";
import type { Track } from "@/contexts/player-types";
import { isOnline as isRuntimeOnline } from "@/lib/capacitor";
import { ensureMediaAccessUrl, requiresMediaAccessTicket } from "@/lib/api";
import { usesConfigurableServer } from "@/lib/platform";

const STREAM_PROBE_TIMEOUT_MS = 4000;

export async function probeTrackAvailability(
  track: Track | undefined,
  options: { serverReachableOnly?: boolean } = {},
): Promise<boolean> {
  if (!track) return false;

  const online = await isRuntimeOnline();
  if (!online) return false;

  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    STREAM_PROBE_TIMEOUT_MS,
  );
  try {
    const streamUrl = getStreamUrl(track);
    const url = requiresMediaAccessTicket(streamUrl)
      ? await Promise.race([
          ensureMediaAccessUrl(streamUrl, "stream"),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener(
              "abort",
              () => reject(controller.signal.reason),
              { once: true },
            );
          }),
        ])
      : streamUrl;
    const response = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      credentials: usesConfigurableServer ? "omit" : "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
    response.body?.cancel().catch(() => {});
    if (options.serverReachableOnly) return response.status < 500;
    return response.ok || response.status === 206;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}
