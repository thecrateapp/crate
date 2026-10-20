import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { Flame } from "@crate/ui/icons";
import { SectionHeader } from "@crate/ui/domain/lists/SectionHeader";
import { ArtistCommunityGroupFrame } from "./ArtistLibraryFrames";
import { ArtistShowPrepView } from "./ArtistShowPrepView";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { ArtistCard } from "@/components/cards/ArtistCard";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import {
  buildArtistPhotoUrl,
  type ArtistPlaylistAppearance,
} from "@/components/artist/artist-model";
import { artistPagePath } from "@/lib/library-routes";
import {
  groupByMonth,
  itemKey,
  UpcomingMonthGroup,
  type UpcomingItem,
} from "@/components/upcoming/UpcomingRows";

interface ArtistShowsSectionProps {
  shows: UpcomingItem[];
  expandedShowId: string | null;
  artistHotNow: boolean;
  onToggleExpand: (showId: string | null) => void;
  onPlayProbableSetlist: () => void;
}

export function ArtistShowsSection({
  shows,
  expandedShowId,
  artistHotNow,
  onToggleExpand,
  onPlayProbableSetlist,
}: ArtistShowsSectionProps) {
  const { t, i18n } = useTranslation();
  const nextAttendingShow = shows.find((item) => item.user_attending);
  if (!shows.length) return null;

  return (
    <section>
      <div className="mb-4 space-y-4">
        <SectionHeader
          title={t("artist.sections.shows")}
          action={
            artistHotNow ? (
              <InfoBadge icon={Flame}>
                {t("artist.sections.heavyRotation")}
              </InfoBadge>
            ) : undefined
          }
        />
        {nextAttendingShow ? (
          <ArtistShowPrepView
            title={nextAttendingShow.title}
            context={`${nextAttendingShow.subtitle} · ${new Date(`${nextAttendingShow.date}T12:00:00`).toLocaleDateString(i18n.language, { month: "long", day: "numeric", year: "numeric" })}`}
            hasSetlist={!!nextAttendingShow.probable_setlist?.length}
            onPlay={onPlayProbableSetlist}
            onDetails={() => onToggleExpand(itemKey(nextAttendingShow, 0))}
          />
        ) : null}
      </div>

      <div className="space-y-3">
        {groupByMonth(shows).map(([month, monthItems]) => (
          <UpcomingMonthGroup
            key={month}
            month={month}
            items={monthItems}
            expandedId={expandedShowId}
            onToggleExpand={onToggleExpand}
          />
        ))}
      </div>
    </section>
  );
}

interface RelatedArtistsSectionProps {
  artists: {
    name: string;
    match: number;
    id?: number;
    slug?: string;
    image_url?: string | null;
    url?: string | null;
    source?: string | null;
  }[];
}

export function RelatedArtistsSection({ artists }: RelatedArtistsSectionProps) {
  const { t } = useTranslation();
  if (!artists.length) return null;

  return (
    <ArtistCommunityGroupFrame title={t("artist.sections.relatedArtists")}>
      {artists.slice(0, 15).map((artist) => {
        const inLibrary = artist.id != null;
        return (
          <ArtistCard
            key={artist.id ?? artist.name}
            name={artist.name}
            artistId={artist.id}
            artistSlug={artist.slug}
            photo={
              inLibrary
                ? buildArtistPhotoUrl(artist.name, artist.id, artist.slug)
                : artist.image_url || undefined
            }
            subtitle={
              Number.isFinite(artist.match)
                ? t("artist.sections.match", {
                    percent: Math.round(artist.match * 100),
                  })
                : undefined
            }
            href={
              inLibrary
                ? artistPagePath({
                    artistId: artist.id,
                    artistSlug: artist.slug,
                  })
                : artist.url ||
                  `https://www.last.fm/music/${encodeURIComponent(artist.name)}`
            }
            external={!inLibrary}
            imageTone={inLibrary ? "normal" : "muted"}
            large
            layout="grid"
          />
        );
      })}
    </ArtistCommunityGroupFrame>
  );
}

interface ArtistAppearsOnSectionProps {
  playlists: ArtistPlaylistAppearance[];
}

export function ArtistAppearsOnSection({
  playlists,
}: ArtistAppearsOnSectionProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (!playlists.length) return null;

  return (
    <ArtistCommunityGroupFrame title={t("artist.sections.appearsOn")}>
      {playlists.slice(0, 8).map((playlist) => {
        const artistTrackCount = playlist.artist_track_count ?? 0;
        return (
          <PlaylistCard
            key={playlist.id}
            playlistId={playlist.id}
            name={playlist.name}
            isSmart={!!playlist.is_smart}
            description={playlist.description ?? undefined}
            tracks={playlist.artwork_tracks}
            coverDataUrl={playlist.cover_data_url}
            meta={
              artistTrackCount > 0
                ? t("artist.sections.tracksHere", {
                    count: artistTrackCount,
                  })
                : t("common.trackCountLabel", {
                    count: playlist.track_count ?? 0,
                  })
            }
            systemPlaylist
            crateManaged={playlist.scope === "system"}
            layout="grid"
            onClick={() => navigate(`/curation/playlist/${playlist.id}`)}
          />
        );
      })}
    </ArtistCommunityGroupFrame>
  );
}
