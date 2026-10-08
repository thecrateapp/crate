import { useTranslation } from "react-i18next";

import { CoreTracksArtwork } from "@/components/home/CoreTracksArtwork";
import { homePlaylistPath } from "@/components/home/HomeCustomMixes";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";

import type { HomeGeneratedPlaylistSummary } from "./home-model";

export function CoreTracksPlaylistCard({
  item,
  onOpenPlaylist,
  onPlayPlaylist,
  onShufflePlaylist,
  onStartRadio,
}: {
  item: HomeGeneratedPlaylistSummary;
  onOpenPlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onPlayPlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onShufflePlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onStartRadio: (item: HomeGeneratedPlaylistSummary) => void;
  layout?: "rail" | "grid";
}) {
  const { t } = useTranslation();

  return (
    <PlaylistCard
      variant="featured"
      name={item.name}
      href={homePlaylistPath(item.id)}
      renderArtwork={(className) => (
        <CoreTracksArtwork item={item} className={className} />
      )}
      meta={t("common.trackCount", { count: item.track_count })}
      artworkOnly
      onClick={() => onOpenPlaylist(item)}
      onPlay={() => onPlayPlaylist(item)}
      onShuffle={() => onShufflePlaylist(item)}
      onStartRadio={() => onStartRadio(item)}
    />
  );
}
