import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import {
  artistGenreSlug,
  type ArtistData,
  type ArtistInfo,
} from "@/components/artist/artist-model";
import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";
import {
  GenrePillRow,
  type GenreProfileItem,
} from "@crate/ui/domain/genres/GenrePill";
import { api } from "@/lib/api";
import { CrateImage } from "@/components/artwork/CrateImage";
import { openExternalUrl } from "@/lib/external-links";
import { formatCompact } from "@/lib/utils";
import { Globe, ChevronDown, ChevronUp } from "@crate/ui/icons";

interface MBMember {
  name: string;
  attributes?: string[];
  begin?: string;
  end?: string;
}
interface EnrichmentData {
  lastfm?: {
    bio?: string;
    tags?: string[];
    similar?: { name: string; match: number }[];
    listeners?: number;
  };
  spotify?: { followers?: number; popularity?: number };
  musicbrainz?: {
    country?: string;
    area?: string;
    begin_date?: string;
    type?: string;
    members?: MBMember[];
    urls?: Record<string, string>;
  };
}

interface ArtistBioModalProps {
  open: boolean;
  artist: ArtistData;
  artistInfo?: ArtistInfo;
  photoUrl: string;
  tags: string[];
  onClose: () => void;
}

const LINK_LABELS: Record<string, string> = {
  "official homepage": "Website",
  discogs: "Discogs",
  wikidata: "Wikidata",
  bandcamp: "Bandcamp",
  youtube: "YouTube",
  "social network": "Social",
  "streaming music": "Streaming",
};

function linkLabel(type: string, url: string): string {
  const lower = type.toLowerCase();
  for (const [key, label] of Object.entries(LINK_LABELS)) {
    if (lower.includes(key)) return label;
  }
  if (url.includes("bandcamp.com")) return "Bandcamp";
  if (url.includes("youtube.com")) return "YouTube";
  if (url.includes("instagram.com")) return "Instagram";
  if (url.includes("twitter.com") || url.includes("x.com")) return "X";
  if (url.includes("facebook.com")) return "Facebook";
  return type || "Link";
}

function useArtistBioEnrichment(open: boolean, artistId?: number) {
  const [enrichment, setEnrichment] = useState<EnrichmentData | null>(null);

  useEffect(() => {
    if (!open || !artistId) {
      setEnrichment(null);
      return;
    }

    let cancelled = false;
    setEnrichment(null);
    api<EnrichmentData>(`/api/artists/${artistId}/enrichment`)
      .then((data) => {
        if (!cancelled) setEnrichment(data);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [open, artistId]);

  return enrichment;
}

function ArtistBioHeader({
  artist,
  genreItems,
  mb,
  navigate,
  onClose,
  photoUrl,
}: {
  artist: ArtistData;
  genreItems: GenreProfileItem[];
  mb: EnrichmentData["musicbrainz"];
  navigate: ReturnType<typeof useNavigate>;
  onClose: () => void;
  photoUrl: string;
}) {
  return (
    <ModalHeader
      data-testid="artist-bio-header"
      className="relative top-auto z-auto border-b-0 bg-transparent backdrop-blur-none"
    >
      <div className="flex items-start justify-between gap-4 px-5 py-5 sm:px-6">
        <div className="flex min-w-0 items-start gap-4">
          <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl bg-surface-quiet-subtle shadow-xl">
            <CrateImage
              src={photoUrl}
              alt={artist.name}
              className="h-full w-full object-cover"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold text-text-primary sm:text-2xl">
              {artist.name}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
              {mb?.begin_date ? <span>Since {mb.begin_date}</span> : null}
              {mb?.country ? (
                <span>
                  {mb.area ? `${mb.area}, ${mb.country}` : mb.country}
                </span>
              ) : null}
            </div>
            {genreItems.length > 0 ? (
              <GenrePillRow
                items={genreItems}
                max={3}
                className="mt-3"
                onSelect={(item) => {
                  navigate(
                    `/explore?genre=${encodeURIComponent(
                      item.slug || artistGenreSlug(item.name),
                    )}`,
                  );
                  onClose();
                }}
              />
            ) : null}
          </div>
        </div>
        <ModalCloseButton
          onClick={onClose}
          className="flex-shrink-0 text-text-secondary transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action-strong"
        />
      </div>
    </ModalHeader>
  );
}

function ArtistBioStats({
  listeners,
  playcount,
  spotifyFollowers,
  spotifyPopularity,
}: {
  listeners: number;
  playcount: number;
  spotifyFollowers: number;
  spotifyPopularity: number;
}) {
  if (listeners <= 0 && spotifyFollowers <= 0) return null;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {listeners > 0 ? (
        <div>
          <div className="text-xl font-bold text-text-hero">
            {formatCompact(listeners)}
          </div>
          <div className="text-[11px] text-text-meta">listeners</div>
        </div>
      ) : null}
      {playcount > 0 ? (
        <div>
          <div className="text-xl font-bold text-text-hero">
            {formatCompact(playcount)}
          </div>
          <div className="text-[11px] text-text-meta">scrobbles</div>
        </div>
      ) : null}
      {spotifyFollowers > 0 ? (
        <div>
          <div className="text-xl font-bold text-text-hero">
            {formatCompact(spotifyFollowers)}
          </div>
          <div className="text-[11px] text-text-meta">followers</div>
        </div>
      ) : null}
      {spotifyPopularity > 0 ? (
        <div>
          <div className="text-xl font-bold text-text-hero">
            {spotifyPopularity}%
          </div>
          <div className="text-[11px] text-text-meta">popularity</div>
        </div>
      ) : null}
    </div>
  );
}

function ArtistBioText({
  bio,
  bioExpanded,
  onToggle,
}: {
  bio: string;
  bioExpanded: boolean;
  onToggle: () => void;
}) {
  if (!bio) return null;

  return (
    <div>
      <p className="whitespace-pre-line text-sm leading-7 text-text-secondary-strong sm:text-[15px]">
        {bioExpanded ? bio : bio.slice(0, 500)}
        {!bioExpanded && bio.length > 500 ? "..." : null}
      </p>
      {bio.length > 500 ? (
        <button
          type="button"
          onClick={onToggle}
          className="mt-2 flex items-center gap-1 text-xs text-accent-action hover:text-accent-action-hover"
        >
          {bioExpanded ? (
            <>
              <ChevronUp size={12} /> Less
            </>
          ) : (
            <>
              <ChevronDown size={12} /> More
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}

function ArtistBioMembers({ members }: { members: MBMember[] }) {
  if (!members.length) return null;

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-meta">
        Members
      </h3>
      <div className="space-y-1">
        {members.map((member) => (
          <div
            key={`${member.name}-${member.begin ?? ""}-${member.end ?? ""}-${
              member.attributes?.join("|") ?? ""
            }`}
            className="flex items-center justify-between border-b border-border-quiet-subtle py-1.5 last:border-0"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-hero">{member.name}</span>
              {member.attributes?.length ? (
                <span className="text-[11px] text-text-quiet">
                  {member.attributes.join(", ")}
                </span>
              ) : null}
            </div>
            <span className="text-[11px] text-text-quiet">
              {member.begin ?? "?"} - {member.end ?? "present"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ArtistLibraryStats({ artist }: { artist: ArtistData }) {
  const size =
    artist.total_size_mb > 1024
      ? `${(artist.total_size_mb / 1024).toFixed(1)} GB`
      : `${artist.total_size_mb} MB`;

  return (
    <div className="flex gap-6 text-[11px] text-text-quiet">
      <span>
        <strong className="text-text-secondary">{artist.albums.length}</strong>{" "}
        albums
      </span>
      <span>
        <strong className="text-text-secondary">{artist.total_tracks}</strong>{" "}
        tracks
      </span>
      <span>
        <strong className="text-text-secondary">{size}</strong>
      </span>
    </div>
  );
}

function ArtistExternalLinks({
  urls,
}: {
  urls: Array<{ type: string; url: string }>;
}) {
  if (!urls.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {urls.map((link) => (
        <a
          key={`${link.type}-${link.url}`}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => {
            event.preventDefault();
            void openExternalUrl(link.url);
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border-quiet px-2.5 py-1 text-[11px] text-text-muted-strong transition-colors hover:border-border-interactive hover:bg-surface-quiet-subtle hover:text-text-secondary-strong"
        >
          <Globe size={11} /> {linkLabel(link.type, link.url)}
        </a>
      ))}
    </div>
  );
}

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
  const members = mb?.members?.filter((m) => m.name) ?? [];
  const urls = mb?.urls
    ? Object.entries(mb.urls).map(([type, url]) => ({ type, url }))
    : [];
  const listeners = artistInfo?.listeners ?? enrichment?.lastfm?.listeners ?? 0;
  const playcount = artistInfo?.playcount ?? 0;
  const spotifyFollowers = enrichment?.spotify?.followers ?? 0;
  const spotifyPopularity = enrichment?.spotify?.popularity ?? 0;
  const genreItems: GenreProfileItem[] =
    artist.genre_profile && artist.genre_profile.length > 0
      ? artist.genre_profile
      : tags.map((tag) => ({
          name: tag,
          slug: artistGenreSlug(tag),
          source: "artist",
        }));

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

      <ModalBody className="flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
        <ArtistBioStats
          listeners={listeners}
          playcount={playcount}
          spotifyFollowers={spotifyFollowers}
          spotifyPopularity={spotifyPopularity}
        />

        <ArtistBioText
          bio={bio}
          bioExpanded={bioExpanded}
          onToggle={() => setBioExpanded((expanded) => !expanded)}
        />

        <ArtistBioMembers members={members} />

        <ArtistLibraryStats artist={artist} />

        <ArtistExternalLinks urls={urls} />
      </ModalBody>
    </AppModal>
  );
}
