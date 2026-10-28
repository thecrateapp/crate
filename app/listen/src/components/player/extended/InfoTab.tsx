import { useContext } from "react";
import { PlayerQualityContext } from "../player-quality-context";
import { useNavigate } from "react-router";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useTrackInfo } from "@/hooks/use-track-info";
import { albumPagePath, artistPagePath } from "@/lib/library-routes";
import { InfoTabHeroArtwork } from "./InfoTabHeroArtwork";
import { InfoTabView } from "./InfoTabView";
export function InfoTab({ className }: { className?: string }) {
  const { currentTrack } = usePlayerActions();
  const { info, loading, error, retry } = useTrackInfo(currentTrack);
  const navigate = useNavigate();
  const playerQuality = useContext(PlayerQualityContext);
  return (
    <InfoTabView
      playbackQuality={
        playerQuality?.trackId === currentTrack?.id ? playerQuality : undefined
      }
      info={info}
      currentTrack={currentTrack}
      loading={loading}
      error={error}
      onRetry={retry}
      className={className}
      artwork={
        currentTrack ? (
          <InfoTabHeroArtwork
            currentTrack={currentTrack}
            albumName={info?.album || currentTrack.album}
          />
        ) : null
      }
      onOpenArtist={
        currentTrack && (currentTrack.globalArtistUid || currentTrack.artistId)
          ? () =>
              navigate(
                artistPagePath({
                  artistId: currentTrack.artistId,
                  globalArtistUid: currentTrack.globalArtistUid,
                  artistSlug: currentTrack.artistSlug,
                  artistName: info?.artist || currentTrack.artist,
                }),
              )
          : undefined
      }
      onOpenAlbum={
        currentTrack && (currentTrack.globalAlbumUid || currentTrack.albumId)
          ? () =>
              navigate(
                albumPagePath({
                  albumId: currentTrack.albumId,
                  globalAlbumUid: currentTrack.globalAlbumUid,
                  albumSlug: currentTrack.albumSlug,
                  albumName: info?.album || currentTrack.album,
                  artistName: info?.artist || currentTrack.artist,
                }),
              )
          : undefined
      }
    />
  );
}
