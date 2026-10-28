import { useTranslation } from "react-i18next";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { EntityAvatar } from "@crate/ui/domain/entity/EntityAvatar";
import { PlayerIdentityText } from "./PlayerIdentityText";
import { cn } from "@crate/ui/lib/cn";

import { CrateImage } from "@/components/artwork/CrateImage";
import type { CrossfadeTransition } from "@/contexts/player-context";
import type { Track } from "@/contexts/player-types";

interface PlayerTrackIdentityProps {
  currentTrack: Track;
  crossfadeTransition: CrossfadeTransition | null;
  crossfadeProgress: number;
  sourceLabel?: string | null;
  artistAvatarUrl?: string | null;
  onArtistAvatarError?: () => void;
  onArtistClick?: () => void;
  artistClickable?: boolean;
  align?: "center" | "left";
  className?: string;
  sourceClassName?: string;
  badgeClassName?: string;
  badgeTextClassName?: string;
  badgeMaxWidthClassName?: string;
}

export function PlayerTrackIdentity({
  currentTrack,
  crossfadeTransition,
  crossfadeProgress,
  sourceLabel,
  artistAvatarUrl,
  onArtistAvatarError,
  onArtistClick,
  artistClickable = false,
  align = "center",
  className,
  sourceClassName,
  badgeClassName,
  badgeTextClassName,
  badgeMaxWidthClassName,
}: PlayerTrackIdentityProps) {
  const { t } = useTranslation();
  const center = align === "center";

  return (
    <div className={cn(center ? "text-center" : "text-left", className)}>
      {sourceLabel ? (
        <MonoLabel className={cn("mb-2", sourceClassName)}>
          {t("player.playingFrom")} {sourceLabel}
        </MonoLabel>
      ) : null}

      <div className="relative">
        {crossfadeTransition ? (
          <>
            <div
              className="absolute inset-0"
              style={{
                opacity: `calc(1 - var(--listen-crossfade-progress, ${crossfadeProgress}))`,
              }}
            >
              <PlayerIdentityText
                title={crossfadeTransition.outgoing.title}
                album={crossfadeTransition.outgoing.album}
              />
            </div>
            <div
              style={{
                opacity: `var(--listen-crossfade-progress, ${crossfadeProgress})`,
              }}
            >
              <PlayerIdentityText
                title={crossfadeTransition.incoming.title}
                album={crossfadeTransition.incoming.album}
              />
            </div>
          </>
        ) : (
          <>
            <PlayerIdentityText
              title={currentTrack.title}
              album={currentTrack.album}
            />
          </>
        )}
      </div>

      <div
        className={cn("mt-2 flex", center ? "justify-center" : "justify-start")}
      >
        <button
          type="button"
          onClick={onArtistClick}
          aria-label={t("player.goToArtist", { name: currentTrack.artist })}
          disabled={!artistClickable}
          className={cn(
            "inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface-quiet-subtle px-2 py-1.5 transition-colors",
            artistClickable
              ? "active:bg-surface-control-hover"
              : "cursor-default",
            badgeClassName,
          )}
        >
          <EntityAvatar
            src={artistAvatarUrl}
            name={currentTrack.artist}
            alt=""
            size="inline"
            renderImage={(image) => (
              <CrateImage
                src={image.src}
                alt={image.alt}
                className={image.className}
                onError={() => {
                  image.onError();
                  onArtistAvatarError?.();
                }}
              />
            )}
          />
          <span
            className={cn(
              "truncate font-mono text-xs text-text-primary",
              badgeTextClassName,
              badgeMaxWidthClassName ?? "max-w-[240px]",
            )}
          >
            {currentTrack.artist}
          </span>
        </button>
      </div>
    </div>
  );
}
