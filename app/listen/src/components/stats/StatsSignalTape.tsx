import { CrateImage } from "@/components/artwork/CrateImage";
import { albumCoverApiUrl } from "@/lib/library-routes";
import type { StatsTape } from "./stats-types";
import { StatsSignalTapeView } from "./StatsSignalTapeView";
export { TapeBars, localToday } from "./StatsSignalTapeView";
export function StatsSignalTape({ tape }: { tape: StatsTape }) {
  return (
    <StatsSignalTapeView
      tape={tape}
      renderAlbum={(album) => (
        <CrateImage
          src={albumCoverApiUrl(
            {
              albumId: album.album_id,
              globalAlbumUid: album.global_album_uid,
              albumName: album.album,
              artistName: album.artist,
            },
            { size: 128 },
          )}
          alt=""
          className="crate-media-thumbnail size-12 shrink-0 rounded-sm object-cover"
        />
      )}
    />
  );
}
