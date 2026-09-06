import { useState } from "react";
import { useNavigate } from "react-router";

import {
  artistGenreSlug,
  type ArtistData,
} from "@/components/artist/artist-model";
import { AppModal } from "@crate/ui/primitives/AppModal";

import {
  ArtistBioHeader,
  ArtistBioModalContent,
} from "./ArtistBioModalSections";
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
  const navigate = useNavigate();
  const bio = artistInfo?.bio ?? "";
  const [bioExpanded, setBioExpanded] = useState(false);
  const enrichment = useArtistBioEnrichment(open, artist.id);

  const mb = enrichment?.musicbrainz;
  const members = mb?.members?.filter((member) => member.name) ?? [];
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
      maxWidthClassName="sm:max-w-2xl"
      overlayClassName="bg-surface-canvas-overlay"
      panelClassName="listen-glass-panel flex min-h-0 w-full max-w-2xl flex-col overflow-hidden border-0 sm:max-h-[92vh]"
      mobileSafeArea
    >
      <ArtistBioHeader
        artist={artist}
        genreItems={genreItems}
        mb={mb}
        navigate={navigate}
        onClose={onClose}
        photoUrl={photoUrl}
      />
      <ArtistBioModalContent
        artist={artist}
        bio={bio}
        bioExpanded={bioExpanded}
        listeners={listeners}
        members={members}
        onBioToggle={() => setBioExpanded((expanded) => !expanded)}
        playcount={playcount}
        spotifyFollowers={spotifyFollowers}
        spotifyPopularity={spotifyPopularity}
        urls={urls}
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
    slug: artistGenreSlug(tag),
    source: "artist" as const,
  }));
}
