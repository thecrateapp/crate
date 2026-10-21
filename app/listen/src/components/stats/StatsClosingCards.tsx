import { CrateImage } from "@/components/artwork/CrateImage";
import { albumCoverApiUrl, albumPagePath } from "@/lib/library-routes";
import { musicAgeShareYear } from "./stats-tape-model";
import type { StatsDecadeAlbum, StatsMusicAge, StatsTape } from "./stats-types";
import {
  StatsDecadeColumnsView,
  StatsMusicAgeCardView,
} from "./StatsClosingViews";
const albumRoute = (album: StatsDecadeAlbum) => ({
  albumId: album.album_id ?? undefined,
  albumSlug: album.album_slug ?? undefined,
  artistName: album.artist ?? undefined,
  albumName: album.album,
});
export function StatsDecadeColumns(props: {
  musicAge: StatsMusicAge;
  linked?: boolean;
  className?: string;
}) {
  return (
    <StatsDecadeColumnsView
      {...props}
      getAlbumHref={(album) => albumPagePath(albumRoute(album))}
      renderAlbum={(album) => (
        <CrateImage
          src={albumCoverApiUrl(albumRoute(album), { size: 256 })}
          alt=""
          className="stats-decade-cover"
          loading="lazy"
        />
      )}
    />
  );
}
export function StatsMusicAgeCard({
  musicAge,
  tape,
}: {
  musicAge: StatsMusicAge;
  tape: StatsTape | null | undefined;
}) {
  return (
    <StatsMusicAgeCardView
      musicAge={musicAge}
      shareYear={musicAgeShareYear(tape, new Date().getFullYear())}
      decades={<StatsDecadeColumns musicAge={musicAge} linked />}
    />
  );
}
