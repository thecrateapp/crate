import {
  CRATE_ICON_SIZE,
  ChevronDown,
  ChevronUp,
  Globe,
} from "@crate/ui/icons";
import type { ReactNode } from "react";

import {
  ArtistBioText,
  truncateArtistBio,
} from "@crate/ui/domain/ArtistBioText";
import {
  GenrePillRow,
  type GenreProfileItem,
} from "@crate/ui/domain/genres/GenrePill";
import {
  ModalBody,
  ModalCloseButton,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { FormField } from "@crate/ui/primitives/FormField";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { Button } from "@crate/ui/shadcn/button";
import { cn } from "@crate/ui/lib/cn";
import { formatCompact, formatSize } from "../../web/utils";

export interface ArtistBioMember {
  name: string;
  roles?: string[];
  begin?: string | null;
  end?: string | null;
}

export interface ArtistBioStats {
  listeners?: number;
  playcount?: number;
  spotifyFollowers?: number;
  spotifyPopularity?: number;
}

export interface ArtistBioLibraryStats {
  albums: number;
  tracks: number;
  sizeMb: number;
}

export interface ArtistBioExternalLink {
  type: string;
  url: string;
}

export interface ArtistBioProfileLabels {
  biography: string;
  more: string;
  less: string;
  currentMembers: string;
  formerMembers: string;
  member: string;
  role: string;
  since: string;
  from: string;
  to: string;
  unknown: string;
  listeners: string;
  scrobbles: string;
  followers: string;
  popularity: string;
  albums: string;
  tracks: string;
  close: string;
}

export const DEFAULT_ARTIST_BIO_PROFILE_LABELS: ArtistBioProfileLabels = {
  biography: "Biography",
  more: "More",
  less: "Less",
  currentMembers: "Current members",
  formerMembers: "Former members",
  member: "Member",
  role: "Role",
  since: "Since",
  from: "From",
  to: "To",
  unknown: "Unknown",
  listeners: "listeners",
  scrobbles: "scrobbles",
  followers: "followers",
  popularity: "popularity",
  albums: "albums",
  tracks: "tracks",
  close: "Close",
};

export interface ArtistBioProfileProps {
  artistName: string;
  photoUrl?: string;
  photoContent?: ReactNode;
  meta?: string[];
  genres?: GenreProfileItem[];
  bio: string;
  bioExpanded?: boolean;
  onBioToggle?: () => void;
  members?: ArtistBioMember[];
  stats?: ArtistBioStats;
  libraryStats?: ArtistBioLibraryStats;
  urls?: ArtistBioExternalLink[];
  onClose?: () => void;
  onGenreSelect?: (item: GenreProfileItem) => void;
  onExternalLink?: (url: string) => void;
  scrollableBody?: boolean;
  labels?: Partial<ArtistBioProfileLabels>;
  className?: string;
}

const EMPTY_META: string[] = [];
const EMPTY_GENRES: GenreProfileItem[] = [];
const EMPTY_MEMBERS: ArtistBioMember[] = [];
const EMPTY_URLS: ArtistBioExternalLink[] = [];
const MEMBER_MONTH_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});
const MEMBER_DAY_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

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

function formatMemberDate(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  if (!normalized) return fallback;

  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(normalized);
  if (!match) return normalized;

  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : undefined;
  const day = match[3] ? Number(match[3]) : undefined;
  if (!month) return String(year);
  if (month < 1 || month > 12 || (day !== undefined && (day < 1 || day > 31))) {
    return normalized;
  }

  const date = new Date(Date.UTC(year, month - 1, day ?? 1));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    (day !== undefined && date.getUTCDate() !== day)
  ) {
    return normalized;
  }

  return (
    day !== undefined ? MEMBER_DAY_FORMATTER : MEMBER_MONTH_FORMATTER
  ).format(date);
}

function splitBioParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export function ArtistBioMembers({
  members,
  labels = DEFAULT_ARTIST_BIO_PROFILE_LABELS,
}: {
  members: ArtistBioMember[];
  labels?: ArtistBioProfileLabels;
}) {
  const merged = mergeArtistBioMembers(members);
  const current = merged.filter((member) => !member.end);
  const former = merged.filter((member) => member.end);

  if (!merged.length) return null;

  return (
    <div className="space-y-5">
      {current.length > 0 ? (
        <ArtistBioMemberTable
          caption={labels.currentMembers}
          labels={labels}
          members={current}
          current
        />
      ) : null}
      {former.length > 0 ? (
        <ArtistBioMemberTable
          caption={labels.formerMembers}
          labels={labels}
          members={former}
        />
      ) : null}
    </div>
  );
}

function artistBioMemberKey(member: ArtistBioMember) {
  return `${member.name}|${member.begin ?? ""}|${member.end ?? ""}`;
}

export function mergeArtistBioMembers(
  members: ArtistBioMember[],
): ArtistBioMember[] {
  const merged = new Map<string, ArtistBioMember>();
  for (const member of members) {
    const key = artistBioMemberKey(member);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...member, roles: [...new Set(member.roles ?? [])] });
      continue;
    }
    existing.roles = [
      ...new Set([...(existing.roles ?? []), ...(member.roles ?? [])]),
    ];
  }
  return [...merged.values()];
}

function ArtistBioMemberTable({
  caption,
  current = false,
  labels,
  members,
}: {
  caption: string;
  current?: boolean;
  labels: ArtistBioProfileLabels;
  members: ArtistBioMember[];
}) {
  return (
    <FormField
      kind="group"
      label={
        <span role="heading" aria-level={3}>
          {caption}
        </span>
      }
    >
      {(group) => (
        <div
          {...group}
          role="group"
          className="overflow-x-auto rounded-lg border border-border-quiet-subtle"
        >
          <table
            aria-label={caption}
            className="w-full min-w-[28rem] text-left text-sm"
          >
            <thead className="bg-surface-quiet-subtle text-xs uppercase tracking-wider text-text-meta">
              <tr>
                <th className="px-3 py-2">
                  <MonoLabel as="span">{labels.member}</MonoLabel>
                </th>
                <th className="px-3 py-2">
                  <MonoLabel as="span">{labels.role}</MonoLabel>
                </th>
                <th className="px-3 py-2">
                  <MonoLabel as="span">
                    {current ? labels.since : labels.from}
                  </MonoLabel>
                </th>
                {!current ? (
                  <th className="px-3 py-2">
                    <MonoLabel as="span">{labels.to}</MonoLabel>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-quiet-subtle">
              {members.map((member) => (
                <tr key={artistBioMemberKey(member)}>
                  <td className="px-3 py-2 font-medium text-text-hero">
                    {member.name}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">
                    {member.roles?.join(", ") || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-text-quiet">
                    {formatMemberDate(member.begin, labels.unknown)}
                  </td>
                  {!current ? (
                    <td className="whitespace-nowrap px-3 py-2 text-text-quiet">
                      {formatMemberDate(member.end, labels.unknown)}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </FormField>
  );
}

function ArtistBioStats({
  stats,
  labels,
}: {
  stats?: ArtistBioStats;
  labels: ArtistBioProfileLabels;
}) {
  if (!stats) return null;
  const items = [
    ["listeners", stats.listeners, labels.listeners],
    ["scrobbles", stats.playcount, labels.scrobbles],
    ["followers", stats.spotifyFollowers, labels.followers],
    ["popularity", stats.spotifyPopularity, labels.popularity],
  ].filter(
    ([, value]) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0,
  ) as [string, number, string][];

  if (!items.length) return null;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {items.map(([key, value, label]) => (
        <StatNumber
          key={key}
          value={key === "popularity" ? `${value}%` : formatCompact(value)}
          label={<MonoLabel as="span">{label}</MonoLabel>}
          size="sm"
        />
      ))}
    </div>
  );
}

function ArtistBioLibraryStats({
  stats,
  labels,
}: {
  stats?: ArtistBioLibraryStats;
  labels: ArtistBioProfileLabels;
}) {
  if (!stats) return null;

  return (
    <div className="flex flex-wrap gap-6">
      <MonoLabel as="span">
        <strong>{stats.albums}</strong> {labels.albums}
      </MonoLabel>
      <MonoLabel as="span">
        <strong>{stats.tracks}</strong> {labels.tracks}
      </MonoLabel>
      <MonoLabel as="span">{formatSize(stats.sizeMb)}</MonoLabel>
    </div>
  );
}

function ArtistBioExternalLinks({
  links,
  onOpen,
}: {
  links: ArtistBioExternalLink[];
  onOpen?: (url: string) => void;
}) {
  if (!links.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link) => (
        <Button
          asChild
          variant="outline"
          size="lg"
          key={`${link.type}-${link.url}`}
        >
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={(event) => {
              if (!onOpen) return;
              event.preventDefault();
              onOpen(link.url);
            }}
          >
            <Globe size={CRATE_ICON_SIZE.micro} />{" "}
            {linkLabel(link.type, link.url)}
          </a>
        </Button>
      ))}
    </div>
  );
}

export function ArtistBioProfile({
  artistName,
  photoUrl,
  photoContent,
  meta = EMPTY_META,
  genres = EMPTY_GENRES,
  bio,
  bioExpanded = true,
  onBioToggle,
  members = EMPTY_MEMBERS,
  stats,
  libraryStats,
  urls = EMPTY_URLS,
  onClose,
  onGenreSelect,
  onExternalLink,
  scrollableBody = true,
  labels: labelsProp,
  className,
}: ArtistBioProfileProps) {
  const labels = labelsProp
    ? { ...DEFAULT_ARTIST_BIO_PROFILE_LABELS, ...labelsProp }
    : DEFAULT_ARTIST_BIO_PROFILE_LABELS;
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <ModalHeader
        data-testid="artist-bio-header"
        className="relative top-auto z-auto shrink-0"
      >
        <div className="flex items-start justify-between gap-4 p-5 sm:px-6">
          <div className="flex min-w-0 items-start gap-4">
            <MediaCover
              src={photoUrl}
              alt={photoContent ? "" : artistName}
              fallback={photoContent}
              className="size-16 shrink-0"
              renderImage={photoContent ? () => photoContent : undefined}
            />
            <div className="min-w-0">
              <h2 className="truncate font-display text-xl font-bold text-text-primary sm:text-2xl">
                {artistName}
              </h2>
              {meta.length > 0 ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
                  {meta.map((item) => (
                    <MonoLabel as="span" key={item}>
                      {item}
                    </MonoLabel>
                  ))}
                </div>
              ) : null}
              <GenrePillRow
                items={genres}
                max={3}
                className="mt-3"
                onSelect={onGenreSelect}
              />
            </div>
          </div>
          {onClose ? (
            <ModalCloseButton onClick={onClose} label={labels.close} />
          ) : null}
        </div>
      </ModalHeader>
      <ModalBody
        className={cn(
          "min-h-0 flex-1 space-y-6 p-5 sm:px-6",
          scrollableBody
            ? "overflow-y-auto overscroll-contain"
            : "overflow-visible",
        )}
      >
        <ArtistBioStats stats={stats} labels={labels} />
        {bio ? (
          <FormField
            kind="group"
            label={
              <span role="heading" aria-level={3}>
                {labels.biography}
              </span>
            }
          >
            {(group) => (
              <div {...group} role="group">
                <div className="space-y-4 text-sm leading-7 text-text-secondary-strong sm:text-body">
                  {splitBioParagraphs(
                    bioExpanded ? bio : truncateArtistBio(bio, 500),
                  ).map((paragraph, index) => (
                    <p key={`${index}:${paragraph}`}>
                      <ArtistBioText text={paragraph} expanded />
                    </p>
                  ))}
                </div>
                {bio.length > 500 && onBioToggle ? (
                  <Button variant="link" onClick={onBioToggle}>
                    {bioExpanded ? (
                      <>
                        <ChevronUp size={CRATE_ICON_SIZE.micro} /> {labels.less}
                      </>
                    ) : (
                      <>
                        <ChevronDown size={CRATE_ICON_SIZE.micro} />{" "}
                        {labels.more}
                      </>
                    )}
                  </Button>
                ) : null}
              </div>
            )}
          </FormField>
        ) : null}
        <ArtistBioMembers members={members} labels={labels} />
        <ArtistBioLibraryStats stats={libraryStats} labels={labels} />
        <ArtistBioExternalLinks links={urls} onOpen={onExternalLink} />
      </ModalBody>
    </div>
  );
}
