import { useContext, useEffect, useMemo, useState } from "react";
import { MonitorSpeaker, X } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { PlayerActionsContext } from "@/contexts/player-context";
import { getStoredQueue } from "@/contexts/player-utils";
import { useCrateConnectEnabled } from "@/hooks/use-crate-connect-enabled";
import { transferPlaybackToDevice } from "@/lib/crate-connect";
import { formatCrateDeviceName, getListenDeviceId } from "@/lib/listen-device";
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
  const { connect, playAll, seek } = playerActions;
  const connectEnabled = useCrateConnectEnabled();
  const [candidate, setCandidate] = useState<RemotePlaybackState | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const activeInstance =
    connect.transport === "ws"
      ? connect.connectedInstances.find(
          (instance) => instance.instance_id === connect.activeInstanceId,
        )
      : null;
  const isV2RemoteActive =
    connect.transport === "ws" &&
    Boolean(connect.activeInstanceId) &&
    Boolean(connect.playbackInstanceId) &&
    Boolean(activeInstance) &&
    connect.activeInstanceId !== connect.playbackInstanceId;
  const v2Candidate =
    isV2RemoteActive && connect.isRemoteActive ? connect.remoteState : null;

  useEffect(() => {
    setCandidate(null);
    setDismissed(false);
  }, [user?.id]);

  useEffect(() => {
    if (!user || !connectEnabled || dismissed || connect.transport === "ws") {
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
  }, [connect.transport, connectEnabled, dismissed, user?.id]);

  const queue = useMemo(
    () =>
      v2Candidate
        ? remotePlaybackQueue(v2Candidate)
        : candidate
          ? remotePlaybackQueue(candidate)
          : [],
    [candidate, v2Candidate],
  );

  const promptState = v2Candidate ?? candidate;
  if (!connectEnabled || !promptState || dismissed || queue.length === 0)
    return null;

  const activeRemote =
    connect.transport === "ws"
      ? isV2RemoteActive
      : isRecentlyPlayingRemote(promptState);
  const label = formatCrateDeviceName({
    app_platform: activeInstance?.app_platform ?? promptState.app_platform,
    device_label: activeInstance?.device_label ?? promptState.device_label,
    device_type: activeInstance?.device_type ?? promptState.device_type,
  });

  const continueHere = async () => {
    const startIndex = Math.max(
      0,
      Math.min(promptState.current_index || 0, queue.length - 1),
    );
    if (connect.transport === "ws") {
      if (!connect.playbackInstanceId) {
        toast.error("Crate Connect is still connecting");
        return;
      }
      setTransferring(true);
      const sent = connect.requestTransfer(connect.playbackInstanceId);
      setTransferring(false);
      if (!sent) {
        toast.error("Could not transfer playback to this device");
        return;
      }
      setDismissed(true);
      return;
    }
    if (activeRemote) {
      setTransferring(true);
      try {
        await transferPlaybackToDevice(getListenDeviceId(), {
          sourceDeviceId: promptState.device_id,
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

    playAll(queue, startIndex, promptState.play_source || undefined);
    window.setTimeout(() => {
      if (promptState.position_ms > 0) {
        seek(promptState.position_ms / 1000);
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
            {promptState.artist ? `${promptState.artist} - ` : ""}
            {promptState.title || "Unknown track"} -{" "}
            {formatPosition(promptState.position_ms)}
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
