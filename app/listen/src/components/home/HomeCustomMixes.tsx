import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { MixArtwork } from "@/components/home/MixArtwork";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import { MediaRail, SectionHeader } from "@crate/ui/domain/lists";

import type { HomeGeneratedPlaylistSummary, HomeSectionId } from "./home-model";

export function homePlaylistPath(playlistId: string): string {
  return `/home/playlist/${encodeURIComponent(playlistId)}`;
}

function mixArtistSummary(
  item: HomeGeneratedPlaylistSummary,
  t: TFunction,
): string {
  const names = (item.artwork_artists || []).flatMap((artist) => {
    const name = artist.artist_name?.trim();
    return name ? [name] : [];
  });

  if (!names.length) return item.description;
  const [first = "", second = "", third = ""] = names;
  if (names.length === 1) return first;
  if (names.length === 2) return `${first}, ${second}`;
  if (names.length === 3) return `${first}, ${second}, ${third}`;
  return t("home.mixes.artistsAndMore", {
    artists: `${first}, ${second}, ${third}`,
  });
}

export function CustomMixesSection({
  mixes,
  onOpenMix,
  onPlayMix,
  onShuffleMix,
  onStartRadio,
  onViewAll,
}: {
  mixes: HomeGeneratedPlaylistSummary[];
  onOpenMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onPlayMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onShuffleMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onStartRadio: (mix: HomeGeneratedPlaylistSummary) => void;
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const { t } = useTranslation();
  if (!mixes.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.customMixes.title")}
        subtitle={t("home.sections.customMixes.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("custom-mixes")}
      />
      <MediaRail fit="columns">
        {mixes.map((mix) => (
          <CustomMixCard
            key={mix.id}
            item={mix}
            onOpenMix={onOpenMix}
            onPlayMix={onPlayMix}
            onShuffleMix={onShuffleMix}
            onStartRadio={onStartRadio}
          />
        ))}
      </MediaRail>
    </section>
  );
}

export function CustomMixCard({
  item,
  onOpenMix,
  onPlayMix,
  onShuffleMix,
  onStartRadio,
}: {
  item: HomeGeneratedPlaylistSummary;
  onOpenMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onPlayMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onShuffleMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onStartRadio: (mix: HomeGeneratedPlaylistSummary) => void;
  layout?: "rail" | "grid";
}) {
  const { t } = useTranslation();

  return (
    <PlaylistCard
      variant="featured"
      name={item.name}
      href={homePlaylistPath(item.id)}
      renderArtwork={(className) => (
        <MixArtwork item={item} className={className} />
      )}
      summary={mixArtistSummary(item, t)}
      meta={t("common.trackCount", { count: item.track_count })}
      onClick={() => onOpenMix(item)}
      onPlay={() => onPlayMix(item)}
      onShuffle={() => onShuffleMix(item)}
      onStartRadio={() => onStartRadio(item)}
    />
  );
}
