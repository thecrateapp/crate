import type { ReactNode } from "react";
import { EntityCard } from "@crate/ui/domain/entity";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { ProgressHairline } from "@crate/ui/primitives/ProgressHairline";
import { artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";

export function StatCard({
  label,
  value,
}: {
  label: string;
  value: string;
  /** Legacy callers may supply an icon; statistics are text-only. */
  icon?: ReactNode;
}) {
  return (
    <div className="min-w-0 border-t border-border-quiet py-3">
      <MonoLabel>{label}</MonoLabel>
      <div className="mt-2 font-mono text-numeral-sm font-normal tabular-nums text-text-primary">
        {value}
      </div>
    </div>
  );
}

export function PopularityBar({ value }: { value: number }) {
  const percent = Math.max(0, Math.min(100, value));
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-10">
        <ProgressHairline label="Popularity" value={percent / 100} />
      </span>
      <MonoLabel as="span">{percent}</MonoLabel>
    </span>
  );
}

export function SimilarArtistCard({
  id,
  slug,
  name,
  image,
  genres,
  popularity,
}: {
  id?: number;
  slug?: string;
  name: string;
  image?: string;
  genres?: string[];
  popularity?: number;
}) {
  const local = id != null;
  return (
    <EntityCard
      title={name}
      href={
        local
          ? artistPagePath({ artistId: id, artistSlug: slug, artistName: name })
          : `https://www.last.fm/music/${encodeURIComponent(name)}`
      }
      external={!local}
      openLabel={`Open ${name}`}
      shape="circle"
      layout="grid"
      profileSize="tile"
      menuButton="none"
      cover={{
        src:
          image ||
          (local
            ? `${artistPhotoApiUrl({ artistId: id, artistSlug: slug, artistName: name })}?v=stable-similar-photo`
            : null),
        alt: name,
      }}
      subtitle={
        genres?.length ? (
          <MonoLabel as="span">{genres.slice(0, 2).join(", ")}</MonoLabel>
        ) : undefined
      }
      meta={
        popularity != null && popularity > 0 ? (
          <PopularityBar value={popularity} />
        ) : undefined
      }
    />
  );
}

export function fuzzyMatchTrack<
  T extends { title: string; album: string; path: string },
>(songTitle: string, tracks: T[]): T | undefined {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/\s*\(.*?\)\s*/g, "")
      .replace(/\s*\[.*?\]\s*/g, "")
      .replace(/[''`]/g, "'")
      .replace(/[^\w\s']/g, "")
      .trim();

  const normalizedTitle = normalize(songTitle);

  const exact = tracks.find(
    (track) => track.title.toLowerCase() === songTitle.toLowerCase(),
  );
  if (exact) return exact;

  const normalized = tracks.find(
    (track) => normalize(track.title) === normalizedTitle,
  );
  if (normalized) return normalized;

  const contains = tracks.find((track) => {
    const normalizedTrack = normalize(track.title);
    return (
      normalizedTrack.includes(normalizedTitle) ||
      normalizedTitle.includes(normalizedTrack)
    );
  });
  if (contains) return contains;

  return tracks.find(
    (track) =>
      normalize(track.title).startsWith(normalizedTitle) ||
      normalizedTitle.startsWith(normalize(track.title)),
  );
}
