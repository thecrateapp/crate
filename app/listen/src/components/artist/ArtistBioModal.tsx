import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { CrateImage } from "@/components/artwork/CrateImage";
import type { ArtistData } from "@/components/artist/artist-model";
import { AppModal } from "@crate/ui/primitives/AppModal";
import {
  ArtistBioProfile,
  type ArtistBioMember,
} from "@crate/ui/domain/ArtistBioProfile";
import { openExternalUrl } from "@/lib/external-links";
import { genreSlug } from "@/lib/utils";

import type { ArtistBioModalProps } from "./artist-bio-types";
import { useArtistBioEnrichment } from "./use-artist-bio-enrichment";

export type { ArtistBioModalProps } from "./artist-bio-types";

export function ArtistBioModal({
  open,
  artist,
  artistInfo,
  photoUrl,
  tags,
  onClose,
}: ArtistBioModalProps) {
  const { t } = useTranslation();
  const bioLabels = useMemo(
    () => ({
      biography: t("artist.bio.biography"),
      more: t("common.more"),
      less: t("artist.bio.less"),
      currentMembers: t("artist.bio.currentMembers"),
      formerMembers: t("artist.bio.formerMembers"),
      member: t("artist.bio.member"),
      role: t("artist.bio.role"),
      since: t("artist.bio.memberSince"),
      from: t("artist.bio.memberFrom"),
      to: t("artist.bio.memberTo"),
      unknown: t("common.unknown"),
      listeners: t("artist.bio.listeners"),
      scrobbles: t("artist.bio.scrobbles"),
      followers: t("artist.bio.followers"),
      popularity: t("artist.bio.popularity"),
      albums: t("artist.bio.albums"),
      tracks: t("artist.bio.tracks"),
    }),
    [t],
  );
  const navigate = useNavigate();
  const bio = artistInfo?.bio ?? "";
  const [bioExpanded, setBioExpanded] = useState(true);
  const enrichment = useArtistBioEnrichment(open, artist.id);

  const mb = enrichment?.musicbrainz;
  const members: ArtistBioMember[] =
    mb?.members?.flatMap((member) =>
      member.name
        ? [
            {
              name: member.name,
              roles: member.attributes,
              begin: member.begin,
              end: member.end,
            },
          ]
        : [],
    ) ?? [];
  const urls = mb?.urls
    ? Object.entries(mb.urls).map(([type, url]) => ({ type, url }))
    : [];
  const listeners = artistInfo?.listeners ?? enrichment?.lastfm?.listeners ?? 0;
  const playcount = artistInfo?.playcount ?? 0;
  const spotifyFollowers = enrichment?.spotify?.followers ?? 0;
  const spotifyPopularity = enrichment?.spotify?.popularity ?? 0;
  const genreItems = getGenreItems(artist, tags);

  return (
    <AppModal
      open={open}
      onClose={onClose}
      maxWidthClassName="sm:max-w-4xl"
      overlayClassName="bg-surface-canvas-overlay"
      panelClassName="listen-glass-panel flex min-h-0 w-full max-w-4xl flex-col overflow-hidden border-0 sm:max-h-[92vh]"
      mobileSafeArea
    >
      <ArtistBioProfile
        labels={bioLabels}
        artistName={artist.name}
        photoUrl={photoUrl}
        photoContent={
          <CrateImage
            src={photoUrl}
            alt={artist.name}
            className="size-full object-cover"
          />
        }
        meta={[
          ...(mb?.begin_date
            ? [t("artist.bio.since", { date: mb.begin_date })]
            : []),
          ...(mb?.country
            ? [mb.area ? `${mb.area}, ${mb.country}` : mb.country]
            : []),
        ]}
        genres={genreItems}
        bio={bio}
        bioExpanded={bioExpanded}
        onBioToggle={() => setBioExpanded((expanded) => !expanded)}
        members={members}
        stats={{
          listeners,
          playcount,
          spotifyFollowers,
          spotifyPopularity,
        }}
        libraryStats={{
          albums: artist.albums.length,
          tracks: artist.total_tracks,
          sizeMb: artist.total_size_mb,
        }}
        urls={urls}
        onClose={onClose}
        onGenreSelect={(item) => {
          navigate(
            `/explore?genre=${encodeURIComponent(
              item.slug || genreSlug(item.name),
            )}`,
          );
          onClose();
        }}
        onExternalLink={(url) => void openExternalUrl(url)}
      />
    </AppModal>
  );
}

function getGenreItems(artist: ArtistData, tags: string[]) {
  if (artist.genre_profile && artist.genre_profile.length > 0) {
    return artist.genre_profile;
  }
  return tags.map((tag) => ({
    name: tag,
    slug: genreSlug(tag),
    source: "artist" as const,
  }));
}
