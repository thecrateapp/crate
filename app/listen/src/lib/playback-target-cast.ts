import type { CastAppearance } from "@crate/cast-protocol";
import { getAppliedThemeSkin } from "@crate/ui/lib/theme-skin";

import { getCastSenderCapabilities, startCastSession } from "@/lib/cast-sender";
import { isMotionBlocked } from "@/lib/motion-availability";
import type { PlaybackTargetProvider } from "./playback-target-types";

function castAppearance(): CastAppearance {
  const appearance = getAppliedThemeSkin();
  return {
    contractVersion: 1,
    skinId: appearance.skin,
    preferredMode: appearance.mode,
    resolvedMode: appearance.resolvedMode,
    reducedMotion: isMotionBlocked(),
  };
}

function authorityUnavailableReason(
  authority: "cast" | "connect" | "jam" | "local" | undefined,
): string | undefined {
  if (authority === "jam") {
    return "Google Cast is unavailable during a Jam session.";
  }
  if (authority === "connect") {
    return "Switch playback to this device before starting Google Cast.";
  }
  return undefined;
}

export const googleCastTargetProvider: PlaybackTargetProvider = {
  id: "google-cast",
  label: "Cast",
  getTargets: async (context) => {
    const capabilities = await getCastSenderCapabilities();
    if (!capabilities.visible) return [];

    const hasTrack = Boolean(context?.currentTrack);
    const authorityReason = authorityUnavailableReason(
      context?.playbackAuthority,
    );
    const available = capabilities.available && hasTrack && !authorityReason;
    return [
      {
        id: "google-cast:default",
        providerId: "google-cast",
        kind: "google-cast",
        name: capabilities.targetName || "Google Cast",
        subtitle: capabilities.activeSession
          ? "Connected Cast receiver"
          : available
            ? "Choose a Cast receiver"
            : capabilities.available
              ? "Start a track before casting"
              : capabilities.reason,
        active: capabilities.activeSession,
        available,
        unavailableReason: available
          ? undefined
          : authorityReason ??
            (hasTrack
              ? capabilities.reason || "Google Cast is unavailable."
              : "Start a track before casting."),
        capabilities: {
          canPlay: true,
          canSeek: true,
          canSetVolume: true,
        },
      },
    ];
  },
  selectTarget: async (target, context) => {
    const currentTrack = context?.currentTrack;
    if (!currentTrack) {
      return { ok: false, message: "Start a track before casting." };
    }
    const result = await startCastSession({
      track: currentTrack,
      queue: context?.queue,
      currentIndex: context?.currentIndex,
      currentTime: context?.currentTime,
      repeatMode: context?.repeatMode,
      shuffle: context?.shuffle,
      appearance: castAppearance(),
      targetDeviceId: target.id,
    });
    if (result.ok) await (context?.pauseLocal ?? context?.pause)?.();
    return result;
  },
};
