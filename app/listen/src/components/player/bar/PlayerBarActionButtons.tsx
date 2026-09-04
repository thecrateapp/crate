import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import {
  CRATE_ICON_SIZE,
  ListMusic,
  Maximize2,
  Mic2,
  SlidersHorizontal,
} from "@crate/ui/icons";
import { PlayerVolumeControl } from "@/components/player/bar/PlayerVolumeControl";
import { PlaybackTargetMenu } from "@/components/player/PlaybackTargetMenu";
import { QualityBadge } from "@/components/player/bar/QualityBadge";
import type { QualityBadge as QualityBadgeData } from "@/components/player/bar/player-bar-utils";
import type { PlaybackTargetContext } from "@/lib/playback-targets";
import type { Track } from "@/contexts/player-types";

type PlayerBarActionVisibility = {
  isRemoteConnectActive: boolean;
  extendedOpen: boolean;
  allowEqualizer: boolean;
  showEqualizer: boolean;
  showQueue: boolean;
  showLyrics: boolean;
};

type PlayerBarActionButtonsProps = {
  t: TFunction;
  qualityBadge: QualityBadgeData | null;
  showsDeliveryQuality: boolean;
  effectiveVolume: number;
  onVolumeChange: (volume: number) => void;
  onOverlayChange: (open: boolean) => void;
  playbackTargetContext: PlaybackTargetContext;
  visibility: PlayerBarActionVisibility;
  displayQueue: Track[];
  displayCurrentIndex: number;
  onToggleEqualizer: () => void;
  onPrepareEqualizer: () => void;
  onToggleQueue: () => void;
  onPrepareQueue: () => void;
  onToggleLyrics: () => void;
  onPrepareLyrics: () => void;
  onToggleExtendedPlayer: () => void;
  onPrepareExtendedPlayer: () => void;
};

type ActionIconButtonProps = {
  active?: boolean;
  label: string;
  onClick: () => void;
  onPrepare?: () => void;
  children: ReactNode;
  className?: string;
};

function ActionIconButton({
  active = false,
  label,
  onClick,
  onPrepare,
  children,
  className,
}: ActionIconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onPrepare}
      onFocus={onPrepare}
      aria-label={label}
      className={`p-1.5 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action ${
        active ? "text-accent-action" : "text-text-muted"
      } ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

function DesktopActionButtons({
  t,
  qualityBadge,
  showsDeliveryQuality,
  effectiveVolume,
  onVolumeChange,
  onOverlayChange,
  playbackTargetContext,
  visibility,
  displayQueue,
  displayCurrentIndex,
  onToggleEqualizer,
  onPrepareEqualizer,
  onToggleQueue,
  onPrepareQueue,
  onToggleLyrics,
  onPrepareLyrics,
  onToggleExtendedPlayer,
  onPrepareExtendedPlayer,
}: PlayerBarActionButtonsProps) {
  const {
    isRemoteConnectActive,
    extendedOpen,
    allowEqualizer,
    showEqualizer,
    showQueue,
    showLyrics,
  } = visibility;

  return (
    <div className="hidden shrink-0 items-center justify-end md:flex md:w-[260px] lg:w-[340px] xl:w-[min(34vw,520px)] 2xl:w-[min(38vw,680px)]">
      <div className="hidden items-center justify-end gap-1 lg:flex">
        {qualityBadge && (
          <span className="mr-1 inline-flex items-center">
            <QualityBadge
              badge={qualityBadge}
              origin={showsDeliveryQuality ? "stream" : "source"}
            />
          </span>
        )}

        <PlayerVolumeControl
          volume={effectiveVolume}
          onVolumeChange={onVolumeChange}
          onOverlayChange={onOverlayChange}
        />

        <PlaybackTargetMenu
          onOverlayChange={onOverlayChange}
          targetContext={playbackTargetContext}
        />

        {!isRemoteConnectActive && !extendedOpen && allowEqualizer && (
          <ActionIconButton
            onClick={onToggleEqualizer}
            onPrepare={onPrepareEqualizer}
            label={t("player.equalizer")}
            active={showEqualizer}
          >
            <SlidersHorizontal size={CRATE_ICON_SIZE.md} />
          </ActionIconButton>
        )}

        {!extendedOpen && (
          <ActionIconButton
            onClick={onToggleQueue}
            onPrepare={onPrepareQueue}
            label={t("player.queue")}
            active={showQueue}
            className="relative"
          >
            <ListMusic size={CRATE_ICON_SIZE.md} />
            {displayQueue.length > 1 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent-action text-[8px] font-bold text-accent-action-foreground">
                {displayQueue.length - displayCurrentIndex - 1}
              </span>
            )}
          </ActionIconButton>
        )}

        {!isRemoteConnectActive && !extendedOpen && (
          <ActionIconButton
            onClick={onToggleLyrics}
            onPrepare={onPrepareLyrics}
            label={t("player.lyrics")}
            active={showLyrics}
            className="hidden xl:block"
          >
            <Mic2 size={CRATE_ICON_SIZE.md} />
          </ActionIconButton>
        )}

        {!isRemoteConnectActive && (
          <ActionIconButton
            onClick={onToggleExtendedPlayer}
            onPrepare={onPrepareExtendedPlayer}
            label={t("player.expand")}
            active={extendedOpen}
          >
            <Maximize2 size={CRATE_ICON_SIZE.md} />
          </ActionIconButton>
        )}
      </div>
    </div>
  );
}

function CompactActionButtons({
  t,
  visibility,
  onToggleQueue,
  onPrepareQueue,
  onToggleExtendedPlayer,
  onPrepareExtendedPlayer,
}: Pick<
  PlayerBarActionButtonsProps,
  | "t"
  | "visibility"
  | "onToggleQueue"
  | "onPrepareQueue"
  | "onToggleExtendedPlayer"
  | "onPrepareExtendedPlayer"
>) {
  const { extendedOpen, showQueue, isRemoteConnectActive } = visibility;

  return (
    <div className="hidden items-center gap-1 md:flex lg:hidden">
      {!extendedOpen && (
        <ActionIconButton
          onClick={onToggleQueue}
          onPrepare={onPrepareQueue}
          label={t("player.queue")}
          active={showQueue}
        >
          <ListMusic size={CRATE_ICON_SIZE.md} />
        </ActionIconButton>
      )}
      {!isRemoteConnectActive && (
        <ActionIconButton
          onClick={onToggleExtendedPlayer}
          onPrepare={onPrepareExtendedPlayer}
          label={t("player.expand")}
          active={extendedOpen}
        >
          <Maximize2 size={CRATE_ICON_SIZE.md} />
        </ActionIconButton>
      )}
    </div>
  );
}

export function PlayerBarActionButtons(props: PlayerBarActionButtonsProps) {
  return (
    <>
      <DesktopActionButtons {...props} />
      <CompactActionButtons {...props} />
    </>
  );
}
