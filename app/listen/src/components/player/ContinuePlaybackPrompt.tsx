import { useContext, useEffect, useMemo, useState } from "react";
import { MonitorSpeaker, X } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { PlayerActionsContext } from "@/contexts/player-context";
import { getStoredQueue } from "@/contexts/player-utils";
import { useCrateConnectEnabled } from "@/hooks/use-crate-connect-enabled";
import { transferPlaybackToDevice } from "@/lib/crate-connect";
import { getListenDeviceId } from "@/lib/listen-device";
import {
  fetchResumeCandidate,
  isRecentlyPlayingRemote,
  remotePlaybackQueue,
  shouldPromptForRemoteResume,
  type RemotePlaybackState,
} from "@/lib/remote-playback-state";

function formatPosition(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function ContinuePlaybackPrompt() {
  const { user } = useAuth();
  const playerActions = useContext(PlayerActionsContext);
  if (!playerActions)
    throw new Error(
      "ContinuePlaybackPrompt must be used within PlayerProvider",
    );
  const { playAll, seek } = playerActions;
  const connectEnabled = useCrateConnectEnabled();
  const [candidate, setCandidate] = useState<RemotePlaybackState | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [transferring, setTransferring] = useState(false);

  useEffect(() => {
    setCandidate(null);
    setDismissed(false);
  }, [user?.id]);

  useEffect(() => {
    if (!user || !connectEnabled || dismissed) {
      setCandidate(null);
      return;
    }
    let cancelled = false;
    const localSavedAt = getStoredQueue().savedAt;
    fetchResumeCandidate()
      .then(({ candidate: next }) => {
        if (cancelled) return;
        setCandidate(
          shouldPromptForRemoteResume(next, { localSavedAt }) ? next : null,
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [connectEnabled, dismissed, user?.id]);

  const queue = useMemo(
    () => (candidate ? remotePlaybackQueue(candidate) : []),
    [candidate],
  );

  if (!connectEnabled || !candidate || dismissed || queue.length === 0)
    return null;

  const label = candidate.device_label || candidate.device_id;
  const activeRemote = isRecentlyPlayingRemote(candidate);

  const continueHere = async () => {
    const startIndex = Math.max(
      0,
      Math.min(candidate.current_index || 0, queue.length - 1),
    );
    if (activeRemote) {
      setTransferring(true);
      try {
        await transferPlaybackToDevice(getListenDeviceId(), {
          sourceDeviceId: candidate.device_id,
          startPlaying: true,
        });
        setDismissed(true);
      } catch {
        toast.error("Could not transfer playback to this device");
      } finally {
        setTransferring(false);
      }
      return;
    }

    playAll(queue, startIndex, candidate.play_source || undefined);
    window.setTimeout(() => {
      if (candidate.position_ms > 0) {
        seek(candidate.position_ms / 1000);
      }
    }, 250);
    setDismissed(true);
  };

  return (
    <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+7.25rem)] z-[1700] mx-auto max-w-xl rounded-xl border border-white/15 bg-zinc-950/95 p-3 shadow-2xl backdrop-blur sm:bottom-24">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg border border-cyan-400/25 bg-cyan-400/10 p-2 text-cyan-200">
          <MonitorSpeaker size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">
            {activeRemote ? `Playing on ${label}` : `Continue from ${label}`}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {candidate.artist ? `${candidate.artist} - ` : ""}
            {candidate.title || "Unknown track"} -{" "}
            {formatPosition(candidate.position_ms)}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void continueHere()}
              disabled={transferring}
              className="rounded-lg bg-cyan-400 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition-colors hover:bg-cyan-300"
            >
              {transferring
                ? "Transferring..."
                : activeRemote
                  ? "Play here"
                  : "Continue"}
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
            >
              Not now
            </button>
          </div>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
