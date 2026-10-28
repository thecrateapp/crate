import { FormField } from "@crate/ui/primitives/FormField";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@crate/ui/shadcn/button";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import type { Track } from "../../../contexts/player-types";
import type { TrackInfo } from "../../../lib/track-info-data";
export function InfoTabHeroIdentity({
  info,
  currentTrack,
  qualityBadge,
  qualityLabel,
  onOpenArtist,
  onOpenAlbum,
}: {
  info: TrackInfo;
  currentTrack: Track;
  qualityBadge?: ReactNode;
  qualityLabel?: string;
  onOpenArtist?: () => void;
  onOpenAlbum?: () => void;
}) {
  const { t } = useTranslation();
  const artist = info.artist || currentTrack.artist;
  const album = info.album || currentTrack.album;
  return (
    <div className="grid min-w-0 flex-1 content-start gap-2 wrap-anywhere">
      <MonoLabel>{t("player.info.nowInspecting")}</MonoLabel>
      <h2 className="font-display text-2xl font-bold leading-tight text-text-primary">
        {info.title || currentTrack.title}
      </h2>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {onOpenArtist ? (
          <Button
            variant="ghost"
            size="sm"
            className="max-w-full"
            onClick={onOpenArtist}
            aria-label={t("player.info.openArtist", { name: artist })}
          >
            <span className="min-w-0 truncate">{artist}</span>
          </Button>
        ) : (
          <span className="text-sm text-text-muted">{artist}</span>
        )}
        {album ? (
          onOpenAlbum ? (
            <Button
              variant="ghost"
              size="sm"
              className="max-w-full"
              onClick={onOpenAlbum}
              aria-label={t("player.info.openAlbum", { name: album })}
            >
              <span className="min-w-0 truncate">{album}</span>
            </Button>
          ) : (
            <span className="text-sm text-text-muted">{album}</span>
          )
        ) : null}
      </div>
      {qualityBadge ? (
        <FormField kind="group" label={qualityLabel}>
          {(group) => (
            <div
              {...group}
              role="group"
              className="flex min-w-0 flex-wrap gap-2"
            >
              {qualityBadge}
            </div>
          )}
        </FormField>
      ) : null}
    </div>
  );
}
