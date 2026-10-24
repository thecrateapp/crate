import { StatCard } from "@/components/artist/ArtistPageBits";
import { ArtistBioText } from "@crate/ui/domain/ArtistBioText";
import { SectionActionButton } from "@crate/ui/domain/lists/SectionHeader";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Button } from "@crate/ui/shadcn/button";
import { ArtistBioResearchAction } from "./ArtistBioResearchAction";
import { ArtistTopTracksSection } from "./ArtistTopTracksSection";
import type {
  ArtistExternalLink,
  LastfmData,
  MusicBrainzData,
  SpotifyData,
} from "./artistPageTypes";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import type { TopTrack } from "@/hooks/use-artist-data";
import { formatCompact, formatNumber, formatSize } from "@/lib/utils";

interface ArtistOverviewSectionProps {
  bioText: string;
  bioExpanded: boolean;
  onToggleBioExpanded: () => void;
  topTracks: TopTrack[];
  musicbrainz?: MusicBrainzData;
  lastfm?: LastfmData;
  spotify?: SpotifyData;
  externalLinks: ArtistExternalLink[];
  albumCount: number;
  totalTracks: number;
  totalSizeMb: number;
  enrichmentLoading: boolean;
  canResearchBio?: boolean;
  onResearchBio?: () => void;
}

export function ArtistOverviewSection({
  bioText,
  bioExpanded,
  onToggleBioExpanded,
  topTracks,
  musicbrainz,
  lastfm,
  spotify,
  externalLinks,
  albumCount,
  totalTracks,
  totalSizeMb,
  enrichmentLoading,
  canResearchBio = false,
  onResearchBio,
}: ArtistOverviewSectionProps) {
  const members = musicbrainz?.members ?? [];
  const activeMembersCount = members.filter((member) => !member.end).length;
  const showBiography =
    Boolean(bioText) || (canResearchBio && Boolean(onResearchBio));
  const stats = [
    musicbrainz?.type ? { label: "Type", value: musicbrainz.type } : null,
    musicbrainz?.begin_date
      ? { label: "Formed", value: musicbrainz.begin_date }
      : null,
    musicbrainz?.end_date
      ? { label: "Ended", value: musicbrainz.end_date }
      : null,
    musicbrainz?.country
      ? { label: "Country", value: musicbrainz.country }
      : null,
    musicbrainz?.area ? { label: "Area", value: musicbrainz.area } : null,
    activeMembersCount > 0
      ? { label: "Active Members", value: String(activeMembersCount) }
      : null,
    lastfm?.listeners != null
      ? { label: "Listeners", value: formatCompact(lastfm.listeners) }
      : null,
    spotify?.followers != null
      ? { label: "Followers", value: formatCompact(spotify.followers) }
      : null,
    spotify?.popularity != null
      ? { label: "Popularity", value: `${spotify.popularity}%` }
      : null,
    lastfm?.playcount != null
      ? { label: "Scrobbles", value: formatCompact(lastfm.playcount) }
      : null,
  ].filter((stat): stat is { label: string; value: string } => stat !== null);

  return (
    <div className="min-w-0 space-y-8">
      {showBiography ? (
        <InstrumentPanel
          as="section"
          headingLevel={3}
          ruled={false}
          label={{ children: "Biography", tone: "accent" }}
          actions={
            canResearchBio && onResearchBio ? (
              <ArtistBioResearchAction onClick={onResearchBio} />
            ) : undefined
          }
        >
          {bioText ? (
            <p className="max-w-3xl text-sm leading-relaxed text-text-secondary">
              <ArtistBioText
                text={bioText}
                maxChars={600}
                expanded={bioExpanded}
              />
            </p>
          ) : (
            <p className="text-sm text-text-muted">No biography available.</p>
          )}
          {bioText.length > 600 ? (
            <SectionActionButton
              onClick={onToggleBioExpanded}
              aria-expanded={bioExpanded}
            >
              {bioExpanded ? "Less" : "More"}
            </SectionActionButton>
          ) : null}
        </InstrumentPanel>
      ) : null}
      {topTracks.length > 0 ? (
        <InstrumentPanel
          as="section"
          headingLevel={3}
          ruled={showBiography}
          label={{ children: "Top Tracks", tone: "accent" }}
        >
          <ArtistTopTracksSection topTracks={topTracks.slice(0, 5)} />
        </InstrumentPanel>
      ) : null}
      <InstrumentPanel
        as="section"
        headingLevel={3}
        ruled={showBiography || topTracks.length > 0}
        label={{ children: "Stats", tone: "accent" }}
      >
        {stats.length > 0 ? (
          <div className="grid max-w-3xl grid-cols-2 gap-x-6 sm:grid-cols-3 md:grid-cols-4">
            {stats.map((stat) => (
              <StatCard key={stat.label} {...stat} />
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <InfoBadge>{albumCount} albums in library</InfoBadge>
          <InfoBadge>{formatNumber(totalTracks)} tracks</InfoBadge>
          <InfoBadge>{formatSize(totalSizeMb)}</InfoBadge>
        </div>
      </InstrumentPanel>
      {members.length > 0 ? (
        <InstrumentPanel
          as="section"
          headingLevel={3}
          label={{ children: "Members", tone: "accent" }}
        >
          <HairlineList label="Artist members" ruled={false}>
            {members.map((member) => (
              <HairlineRow
                key={`${member.name}-${member.begin ?? ""}-${member.end ?? ""}`}
                truncate={false}
                trailing={
                  <MonoLabel as="span">
                    {member.begin ?? "?"} – {member.end ?? "present"}
                  </MonoLabel>
                }
              >
                <span className="text-sm">{member.name}</span>
                {member.attributes?.length ? (
                  <MonoLabel as="span" className="ml-2">
                    {member.attributes.join(", ")}
                  </MonoLabel>
                ) : null}
              </HairlineRow>
            ))}
          </HairlineList>
        </InstrumentPanel>
      ) : null}
      {externalLinks.length > 0 ? (
        <InstrumentPanel
          as="section"
          headingLevel={3}
          label={{ children: "Links", tone: "accent" }}
        >
          <div className="flex flex-wrap gap-2">
            {externalLinks.map((link) => (
              <Button key={link.label} asChild variant="ghost" size="sm">
                <a href={link.url} target="_blank" rel="noopener noreferrer">
                  {link.label}
                </a>
              </Button>
            ))}
          </div>
        </InstrumentPanel>
      ) : null}
      {enrichmentLoading ? (
        <LoadingState label="Loading artist enrichment" />
      ) : null}
    </div>
  );
}
