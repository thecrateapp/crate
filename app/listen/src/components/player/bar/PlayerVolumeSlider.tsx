import "./player-seek-bar.css";
import type { RefObject } from "react";
import type { TFunction } from "i18next";
import { AppPopover } from "@crate/ui/primitives/AppPopover";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { CRATE_ICON_SIZE, Volume2, VolumeX } from "@crate/ui/icons";
import { PlayerProgressBeam } from "./PlayerProgressBeam";
interface PlayerVolumeSliderProps {
  id: string;
  onVolumeChange: (volume: number) => void;
  onVolumeFromClientY: (clientY: number) => void;
  onVolumeByDelta: (delta: number) => void;
  popoverPosition: { left: number; bottom: number };
  t: TFunction;
  trackRef: RefObject<HTMLDivElement | null>;
  volumePct: number;
  volumeRef: RefObject<HTMLDivElement | null>;
  showMuteAction: boolean;
  onToggleMute: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onFocusChange: (focused: boolean) => void;
  onDragChange: (dragging: boolean) => void;
}
export function PlayerVolumeSlider({
  id,
  onVolumeChange,
  onVolumeFromClientY,
  onVolumeByDelta,
  popoverPosition,
  t,
  trackRef,
  volumePct,
  volumeRef,
  showMuteAction,
  onToggleMute,
  onPointerEnter,
  onPointerLeave,
  onFocusChange,
  onDragChange,
}: PlayerVolumeSliderProps) {
  return (
    <AppPopover
      ref={volumeRef}
      id={id}
      role="dialog"
      aria-label={t("player.volume.label")}
      className="fixed z-app-player-popover w-12 px-0 py-3"
      style={popoverPosition}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocusCapture={() => onFocusChange(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          onFocusChange(false);
      }}
    >
      <div
        ref={trackRef}
        role="slider"
        aria-orientation="vertical"
        aria-label={t("player.volume.label")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(volumePct)}
        tabIndex={0}
        className="listen-player-progress relative mx-auto h-28 w-11 cursor-pointer touch-none crate-focus-inset"
        onPointerDown={(event) => {
          event.preventDefault();
          onDragChange(true);
          event.currentTarget.setPointerCapture(event.pointerId);
          onVolumeFromClientY(event.clientY);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) onVolumeFromClientY(event.clientY);
        }}
        onPointerUp={(event) => {
          onDragChange(false);
          const box = volumeRef.current?.getBoundingClientRect();
          if (
            box &&
            (event.clientX < box.left ||
              event.clientX > box.right ||
              event.clientY < box.top ||
              event.clientY > box.bottom)
          )
            onPointerLeave();
        }}
        onPointerCancel={() => onDragChange(false)}
        onLostPointerCapture={() => onDragChange(false)}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowRight") {
            event.preventDefault();
            onVolumeByDelta(0.05);
          } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
            event.preventDefault();
            onVolumeByDelta(-0.05);
          } else if (event.key === "Home") {
            event.preventDefault();
            onVolumeChange(0);
          } else if (event.key === "End") {
            event.preventDefault();
            onVolumeChange(1);
          }
        }}
      >
        <PlayerProgressBeam
          orientation="vertical"
          progressPercent={volumePct}
        />
      </div>
      {showMuteAction ? (
        <div className="flex justify-center pt-2">
          <ActionButton
            label={
              volumePct === 0
                ? t("player.volume.unmute")
                : t("player.volume.mute")
            }
            onClick={onToggleMute}
          >
            {volumePct === 0 ? (
              <Volume2 size={CRATE_ICON_SIZE.md} />
            ) : (
              <VolumeX size={CRATE_ICON_SIZE.md} />
            )}
          </ActionButton>
        </div>
      ) : null}
    </AppPopover>
  );
}
