import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@crate/ui/lib/cn";
import { notify } from "@crate/ui/lib/notify";

import {
  loadPlaybackTargetGroups,
  selectPlaybackTarget,
  type PlaybackTarget,
  type PlaybackTargetContext,
  type PlaybackTargetGroup,
} from "@/lib/playback-targets";
import {
  CONNECT_ENABLED_EVENT,
  CONNECT_SESSION_EVENT,
} from "@/lib/crate-connect";
import {
  disconnectCastSession,
  onCastSessionChanged,
  stopCastSession,
} from "@/lib/cast-sender";
import { onNativeOutputRouteChanged } from "@/lib/native-output-router";

import { PlaybackTargetPicker } from "./PlaybackTargetPicker";

interface PlaybackTargetMenuProps {
  className?: string;
  onOverlayChange?: (open: boolean) => void;
  targetContext?: PlaybackTargetContext;
}

export function PlaybackTargetMenu({
  className,
  onOverlayChange,
  targetContext,
}: PlaybackTargetMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [castAction, setCastAction] = useState<"disconnect" | "stop" | null>(
    null,
  );
  const [groups, setGroups] = useState<PlaybackTargetGroup[]>([]);
  const [error, setError] = useState(false);
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null);
  const actionBusyRef = useRef(false);
  const targetContextRef = useRef(targetContext);
  useEffect(() => {
    targetContextRef.current = targetContext;
  }, [targetContext]);
  const targetTrackId = targetContext?.currentTrack?.id;
  const activeConnectInstanceId = targetContext?.connect?.activeInstanceId;
  const connectedInstanceCount =
    targetContext?.connect?.connectedInstances.length ?? 0;
  const refreshTargets = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    loadPlaybackTargetGroups(targetContextRef.current)
      .then((nextGroups) => {
        if (!cancelled) setGroups(nextGroups);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const refreshTargetsCleanupRef = useRef<(() => void) | null>(null);
  const runRefreshTargets = useCallback(() => {
    refreshTargetsCleanupRef.current?.();
    refreshTargetsCleanupRef.current = refreshTargets();
  }, [refreshTargets]);

  const handleOverlayChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      onOverlayChange?.(nextOpen);
    },
    [onOverlayChange],
  );

  useEffect(() => {
    runRefreshTargets();
    return () => {
      refreshTargetsCleanupRef.current?.();
      refreshTargetsCleanupRef.current = null;
    };
  }, [
    activeConnectInstanceId,
    connectedInstanceCount,
    runRefreshTargets,
    targetTrackId,
  ]);

  useEffect(() => {
    window.addEventListener(CONNECT_SESSION_EVENT, runRefreshTargets);
    window.addEventListener(CONNECT_ENABLED_EVENT, runRefreshTargets);
    window.addEventListener("focus", runRefreshTargets);
    return () => {
      window.removeEventListener(CONNECT_SESSION_EVENT, runRefreshTargets);
      window.removeEventListener(CONNECT_ENABLED_EVENT, runRefreshTargets);
      window.removeEventListener("focus", runRefreshTargets);
    };
  }, [runRefreshTargets]);

  useEffect(() => onCastSessionChanged(runRefreshTargets), [runRefreshTargets]);

  useEffect(() => {
    if (open) runRefreshTargets();
  }, [open, runRefreshTargets]);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;
    void onNativeOutputRouteChanged(() => {
      runRefreshTargets();
    }).then((nextCleanup) => {
      if (disposed) {
        nextCleanup();
        return;
      }
      cleanup = nextCleanup;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [open, runRefreshTargets]);

  const handleTarget = useCallback(
    async (target: PlaybackTarget): Promise<boolean> => {
      if (actionBusyRef.current) return false;
      if (!target.available) {
        notify.info(
          target.unavailableReason || t("player.output.unavailableToast"),
        );
        return false;
      }
      actionBusyRef.current = true;
      setPendingTargetId(target.id);
      try {
        const result = await selectPlaybackTarget(
          target,
          targetContextRef.current,
        );
        if (!result.ok) {
          notify.info(result.message || t("player.output.unavailableToast"));
          return false;
        }
        runRefreshTargets();
        return true;
      } catch {
        notify.info(t("player.output.unavailableToast"));
        return false;
      } finally {
        actionBusyRef.current = false;
        setPendingTargetId(null);
      }
    },
    [runRefreshTargets, t],
  );
  const handleCastAction = useCallback(
    async (action: "disconnect" | "stop"): Promise<boolean> => {
      if (actionBusyRef.current) return false;
      actionBusyRef.current = true;
      setCastAction(action);
      try {
        const result =
          action === "disconnect"
            ? await disconnectCastSession()
            : await stopCastSession();
        if (!result.ok) {
          notify.info(result.message || t("player.output.cast.actionFailed"));
          return false;
        }
        runRefreshTargets();
        return true;
      } catch {
        notify.info(t("player.output.cast.actionFailed"));
        return false;
      } finally {
        actionBusyRef.current = false;
        setCastAction(null);
      }
    },
    [runRefreshTargets, t],
  );
  return (
    <div className={cn("flex items-center", className)}>
      <PlaybackTargetPicker
        groups={groups}
        loading={loading}
        error={error}
        pendingTargetId={pendingTargetId}
        castAction={castAction}
        onRetry={runRefreshTargets}
        onOverlayChange={handleOverlayChange}
        onTarget={handleTarget}
        onDisconnectCast={() => handleCastAction("disconnect")}
        onStopCast={() => handleCastAction("stop")}
      />
    </div>
  );
}
