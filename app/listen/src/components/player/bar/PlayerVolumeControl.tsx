import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { CRATE_ICON_SIZE, Volume2, VolumeX } from "@crate/ui/icons";

import { useHoverCapability } from "@crate/ui/lib/use-hover-capability";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { useTranslation } from "react-i18next";
import { useVolumeInteraction } from "./use-volume-interaction";
import { PlayerVolumeSlider } from "./PlayerVolumeSlider";
import { focusWithModality } from "@crate/ui/lib/input-modality";

interface PlayerVolumeControlProps {
  volume: number;
  onVolumeChange: (volume: number) => void;
  onOverlayChange: (open: boolean) => void;
}

export function PlayerVolumeControl({
  volume,
  onVolumeChange,
  onOverlayChange,
}: PlayerVolumeControlProps) {
  const sliderId = useId();
  const canUseWheel = useHoverCapability();
  const [touchInteraction, setTouchInteraction] = useState(false);
  const canHover = canUseWheel && !touchInteraction;
  const interaction = useVolumeInteraction({
    volume,
    canHover,
    onVolumeChange,
    onOverlayChange,
  });
  const showVolume = interaction.open;
  const focusRequested = useRef(false);
  const touchPointer = useRef(false);
  const [popoverPosition, setPopoverPosition] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef<HTMLDivElement>(null);
  const volumeButtonRef = useRef<HTMLButtonElement>(null);
  const volumeIconRef = useRef<HTMLSpanElement>(null);
  const volumePct = Math.max(0, Math.min(100, volume * 100));

  const updatePopoverPosition = useCallback(() => {
    const button = volumeButtonRef.current;
    const icon = volumeIconRef.current;
    if (!button) return;
    const buttonRect = button.getBoundingClientRect();
    const anchorRect = icon?.getBoundingClientRect() ?? buttonRect;
    const popoverWidth = 48;
    const desiredLeft = anchorRect.left + anchorRect.width / 2;
    setPopoverPosition({
      left:
        Math.max(
          popoverWidth / 2 + 6,
          Math.min(window.innerWidth - popoverWidth / 2 - 6, desiredLeft),
        ) -
        popoverWidth / 2,
      bottom: window.innerHeight - buttonRect.top + 8,
    });
  }, []);

  const closeVolume = useCallback(() => {
    focusRequested.current = false;
    interaction.hide();
    setPopoverPosition(null);
  }, [interaction.hide]);
  const openVolume = (focus = false) => {
    updatePopoverPosition();
    const slider =
      volumeRef.current?.querySelector<HTMLElement>('[role="slider"]');
    focusRequested.current = focus && !slider;
    interaction.show();
    if (focus && slider) slider.focus();
  };

  useDismissibleLayer({
    active: showVolume,
    refs: [volumeRef, volumeButtonRef],
    closeOnPointerDownOutside: false,
    onDismiss: () => {
      closeVolume();
      focusWithModality(volumeButtonRef.current, { preventScroll: true });
    },
  });

  useEffect(() => {
    if (!showVolume) return;
    updatePopoverPosition();
    if (focusRequested.current) {
      volumeRef.current?.querySelector<HTMLElement>('[role="slider"]')?.focus();
      focusRequested.current = false;
    }
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (volumeRef.current?.contains(target) ||
          volumeButtonRef.current?.contains(target))
      )
        return;
      closeVolume();
    };
    document.addEventListener("pointerdown", handleOutsidePointer, true);
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointer, true);
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [showVolume, updatePopoverPosition, closeVolume]);

  const setVolumeFromClientY = useCallback(
    (clientY: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const pct =
        1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      onVolumeChange(Math.round(pct * 100) / 100);
    },
    [onVolumeChange],
  );

  const setVolumeByDelta = useCallback(
    (delta: number) => {
      onVolumeChange(
        Math.max(0, Math.min(1, Math.round((volume + delta) * 100) / 100)),
      );
    },
    [onVolumeChange, volume],
  );

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (!canUseWheel) return;
      event.preventDefault();
      event.stopPropagation();
      const dominantDelta =
        Math.abs(event.deltaY) >= Math.abs(event.deltaX)
          ? event.deltaY
          : event.deltaX;
      if (dominantDelta === 0) return;
      const step = event.shiftKey ? 0.01 : 0.03;
      setVolumeByDelta(dominantDelta > 0 ? -step : step);
    },
    [canUseWheel, setVolumeByDelta],
  );
  const wheelHandlerRef = useRef(handleWheel);
  useEffect(() => {
    wheelHandlerRef.current = handleWheel;
  }, [handleWheel]);
  useEffect(() => {
    // React delegates wheel events through a passive listener. Register on the
    // two actual volume surfaces so preventDefault stops page scroll here only.
    const surfaces: Array<HTMLElement | null> = [
      volumeButtonRef.current,
      volumeRef.current,
    ];
    const onWheel = (event: WheelEvent) => wheelHandlerRef.current(event);
    for (const surface of surfaces)
      surface?.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      for (const surface of surfaces)
        surface?.removeEventListener("wheel", onWheel);
    };
  }, [showVolume]);

  return (
    <div
      className="relative flex items-center"
      onPointerDownCapture={(event) => {
        if (event.pointerType === "touch") setTouchInteraction(true);
      }}
      onPointerEnter={(event) => {
        if (event.pointerType === "touch") {
          setTouchInteraction(true);
          return;
        }
        if (canUseWheel) {
          setTouchInteraction(false);
          openVolume();
          interaction.enter();
        }
      }}
      onPointerLeave={interaction.leave}
    >
      <ActionButton
        ref={volumeButtonRef}
        onPointerDown={(event) => {
          touchPointer.current = event.pointerType === "touch";
          setTouchInteraction(touchPointer.current);
        }}
        onClick={() => {
          if (canUseWheel && !touchPointer.current) interaction.toggleMute();
          else if (showVolume) closeVolume();
          else openVolume(true);
          touchPointer.current = false;
        }}
        onKeyDown={(event) => {
          touchPointer.current = false;
          setTouchInteraction(false);
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            openVolume(true);
          }
        }}
        label={
          canHover
            ? volume === 0
              ? t("player.volume.unmute")
              : t("player.volume.mute")
            : t("player.volume.label")
        }
        aria-pressed={canHover ? volume === 0 : undefined}
        aria-haspopup="dialog"
        aria-expanded={showVolume}
        aria-controls={showVolume ? sliderId : undefined}
      >
        <span
          ref={volumeIconRef}
          className="listen-player-volume-icon block"
          data-muted={volume === 0 || undefined}
          style={
            {
              "--volume-level": Math.max(0, Math.min(1, volume)),
            } as CSSProperties
          }
        >
          {volume === 0 ? (
            <VolumeX size={CRATE_ICON_SIZE.md} />
          ) : (
            <Volume2 size={CRATE_ICON_SIZE.md} />
          )}
        </span>
      </ActionButton>
      {showVolume && popoverPosition
        ? createPortal(
            <PlayerVolumeSlider
              id={sliderId}
              onVolumeChange={onVolumeChange}
              onVolumeFromClientY={setVolumeFromClientY}
              onVolumeByDelta={setVolumeByDelta}
              popoverPosition={popoverPosition}
              t={t}
              trackRef={trackRef}
              volumePct={volumePct}
              volumeRef={volumeRef}
              showMuteAction={!canHover}
              onToggleMute={interaction.toggleMute}
              onPointerEnter={interaction.enter}
              onPointerLeave={interaction.leave}
              onFocusChange={interaction.setFocused}
              onDragChange={interaction.setDragging}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
