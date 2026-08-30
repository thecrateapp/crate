import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Airplay,
  Cast,
  Check,
  CRATE_ICON_SIZE,
  Loader2,
  MonitorSpeaker,
  RadioTower,
} from "@crate/ui/icons";
import { AppPopover } from "@crate/ui/primitives/AppPopover";
import { cn } from "@crate/ui/lib/cn";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

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
import { onNativeOutputRouteChanged } from "@/lib/native-output-router";

interface PlaybackTargetMenuProps {
  className?: string;
  onOverlayChange?: (open: boolean) => void;
  targetContext?: PlaybackTargetContext;
}

function TargetIcon({ target }: { target: PlaybackTarget }) {
  if (target.kind === "google-cast") return <Cast size={CRATE_ICON_SIZE.md} />;
  if (target.kind === "airplay") return <Airplay size={CRATE_ICON_SIZE.md} />;
  if (target.kind === "crate-device")
    return <RadioTower size={CRATE_ICON_SIZE.md} />;
  return <MonitorSpeaker size={CRATE_ICON_SIZE.md} />;
}

export function PlaybackTargetMenu({
  className,
  onOverlayChange,
  targetContext,
}: PlaybackTargetMenuProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<PlaybackTargetGroup[]>([]);
  const [popoverPosition, setPopoverPosition] = useState<{
    right: number;
    bottom: number;
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const targetContextRef = useRef(targetContext);
  targetContextRef.current = targetContext;
  const targetTrackId = targetContext?.currentTrack?.id;
  const activeConnectInstanceId = targetContext?.connect?.activeInstanceId;
  const connectedInstanceCount =
    targetContext?.connect?.connectedInstances.length ?? 0;
  const activeTarget = useMemo(
    () =>
      groups.flatMap((group) => group.targets).find((target) => target.active),
    [groups],
  );

  const refreshTargets = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    loadPlaybackTargetGroups(targetContextRef.current)
      .then((nextGroups) => {
        if (!cancelled) setGroups(nextGroups);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
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

  const updatePopoverPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setPopoverPosition({
      right: Math.max(8, window.innerWidth - rect.right),
      bottom: window.innerHeight - rect.top + 8,
    });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setPopoverPosition(null);
    onOverlayChange?.(false);
  }, [onOverlayChange]);

  useDismissibleLayer({
    active: open,
    refs: [buttonRef, popoverRef],
    onDismiss: close,
  });

  useEffect(() => {
    if (!open) return;
    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [open, updatePopoverPosition]);

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
    async (target: PlaybackTarget) => {
      if (!target.available) {
        toast.info(
          target.unavailableReason || t("player.output.unavailableToast"),
        );
        return;
      }
      const result = await selectPlaybackTarget(
        target,
        targetContextRef.current,
      );
      if (!result.ok && result.message) {
        toast.info(result.message);
        return;
      }
      close();
    },
    [close, t],
  );

  const badgeText = (target: PlaybackTarget): string => {
    if (target.active) return t("player.output.badge.active");
    if (!target.available) return t("player.output.badge.unavailable");
    if (target.kind === "system-route") return t("player.output.badge.system");
    return t("player.output.badge.ready");
  };

  return (
    <div className={cn("flex items-center", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={t("player.output.label")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const nextOpen = !open;
          if (nextOpen) updatePopoverPosition();
          setOpen(nextOpen);
          onOverlayChange?.(nextOpen);
        }}
        className={cn(
          "relative inline-flex items-center gap-1.5 rounded-md p-1.5 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-[0_0_8px_var(--accent-action-glow)]",
          open || (activeTarget && activeTarget.kind !== "local")
            ? "text-accent-action drop-shadow-[0_0_8px_var(--accent-action-glow)]"
            : "text-text-muted",
        )}
      >
        <Airplay size={CRATE_ICON_SIZE.md} />
        {activeTarget && activeTarget.kind !== "local" ? (
          <span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-accent-action shadow-[0_0_8px_var(--accent-action-glow-strong)]" />
        ) : null}
      </button>

      {open && popoverPosition
        ? createPortal(
            <AppPopover
              ref={popoverRef}
              role="menu"
              aria-label={t("player.output.targets")}
              className="fixed z-[1600] w-[min(calc(100vw-1rem),340px)] rounded-[12px] p-2"
              style={{
                right: popoverPosition.right,
                bottom: popoverPosition.bottom,
              }}
            >
              <div className="px-2 pb-2 pt-1">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                  {t("player.output.label")}
                </div>
              </div>
              {loading ? (
                <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                  <Loader2 size={CRATE_ICON_SIZE.sm} className="animate-spin" />
                  {t("player.output.loading")}
                </div>
              ) : (
                <div className="max-h-[360px] overflow-y-auto">
                  {groups.map((group) => (
                    <div key={group.providerId} className="pb-2 last:pb-0">
                      <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-text-subtle">
                        {group.label}
                      </div>
                      {group.targets.map((target) => (
                        <button
                          key={target.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={target.active}
                          aria-disabled={!target.available}
                          onClick={() => void handleTarget(target)}
                          className={cn(
                            "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                            target.available
                              ? "text-text-primary hover:bg-surface-control"
                              : "text-text-subtle hover:bg-surface-control",
                          )}
                        >
                          <span
                            className={cn(
                              "mt-0.5 rounded-lg border p-1.5",
                              target.active
                                ? "border-border-interactive bg-surface-control text-accent-action"
                                : "border-border-quiet bg-surface-control text-text-muted",
                            )}
                          >
                            <TargetIcon target={target} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">
                                {target.name}
                              </span>
                              {target.active ? (
                                <Check
                                  size={13}
                                  className="shrink-0 text-accent-action"
                                />
                              ) : null}
                            </span>
                            {target.subtitle ? (
                              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                {target.subtitle}
                              </span>
                            ) : null}
                          </span>
                          <span
                            className={cn(
                              "mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                              target.active
                                ? "border-border-interactive bg-surface-control text-accent-action"
                                : target.available
                                  ? "border-border-quiet bg-surface-control text-text-secondary"
                                  : "border-border-quiet bg-surface-canvas text-text-subtle",
                            )}
                          >
                            {badgeText(target)}
                          </span>
                        </button>
                      ))}
                      {group.error ? (
                        <div className="px-3 py-2 text-xs text-muted-foreground">
                          {group.error}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {groups.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-muted-foreground">
                      {t("player.output.empty")}
                    </div>
                  ) : null}
                </div>
              )}
            </AppPopover>,
            document.body,
          )
        : null}
    </div>
  );
}
