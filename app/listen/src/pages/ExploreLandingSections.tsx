import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { ArrowRight, CRATE_ICON_SIZE, Radio } from "@crate/ui/icons";
import { MediaRail, SectionHeader } from "@crate/ui/domain/lists";
import { notify } from "@crate/ui/lib/notify";

import {
  type BrowseFilters,
  type MoodPreset,
  type SystemPlaylist,
} from "@/components/explore/explore-model";
import { GenreTile } from "@/components/explore/GenreTile";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { api, resolveMaybeApiAssetUrl } from "@/lib/api";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";

const MOOD_COLORS: Record<string, string> = {
  energetic: "bg-state-warning/20 text-state-warning border-state-warning/30",
  chill: "bg-state-info/20 text-state-info border-state-info/30",
  dark: "bg-state-danger/20 text-state-danger border-state-danger/30",
  happy: "bg-state-warning/20 text-state-warning border-state-warning/30",
  melancholy: "bg-state-info/20 text-state-info border-state-info/30",
  intense: "bg-state-danger/20 text-state-danger border-state-danger/30",
  groovy: "bg-state-success/20 text-state-success border-state-success/30",
  acoustic: "bg-state-warning/20 text-state-warning border-state-warning/30",
};

const MOOD_LABEL_KEY: Record<string, string> = {
  energetic: "explore.moods.names.energetic",
  chill: "explore.moods.names.chill",
  dark: "explore.moods.names.dark",
  happy: "explore.moods.names.happy",
  melancholy: "explore.moods.names.melancholy",
  intense: "explore.moods.names.intense",
  groovy: "explore.moods.names.groovy",
  acoustic: "explore.moods.names.acoustic",
};

function moodLabel(mood: string, t: TFunction) {
  const key = MOOD_LABEL_KEY[mood];
  return key ? t(key) : mood.charAt(0).toUpperCase() + mood.slice(1);
}

export function ExploreFeatureCard({
  title,
  subtitle,
  icon: Icon,
  onClick,
}: {
  title: string;
  subtitle: string;
  icon: typeof Radio;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="explore-feature-card group relative min-h-36 overflow-hidden rounded-panel p-5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-action/60"
    >
      <div className="explore-feature-card-aura absolute inset-0 opacity-80 transition group-hover:opacity-100" />
      <div className="relative flex h-full flex-col justify-between gap-8">
        <div className="flex items-center justify-between">
          <Icon
            size={CRATE_ICON_SIZE.xl}
            className="text-accent-action drop-shadow-accent-action-feature"
          />
          <ArrowRight
            size={CRATE_ICON_SIZE.md}
            className="text-text-primary/35 transition group-hover:translate-x-1 group-hover:text-accent-action"
          />
        </div>
        <div>
          <div className="text-xl font-black tracking-[-0.035em] text-text-primary">
            {title}
          </div>
          <div className="mt-2 max-w-[28rem] text-sm leading-5 text-text-primary/58">
            {subtitle}
          </div>
        </div>
      </div>
    </button>
  );
}

export function ExploreCratePlaylists({
  playlists,
  onOpen,
  onPlay,
  onToggleFollow,
}: {
  playlists: SystemPlaylist[];
  onOpen: (playlistId: number) => void;
  onPlay: (playlistId: number, playlistName: string) => void;
  onToggleFollow: (playlistId: number, isFollowed: boolean) => void;
}) {
  const { t } = useTranslation();

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("explore.fromCrate.title")}
        subtitle={t("explore.fromCrate.subtitle")}
      />
      <MediaRail>
        {playlists.map((playlist) => (
          <PlaylistCard
            key={playlist.id}
            playlistId={playlist.id}
            name={playlist.name}
            isSmart={playlist.is_smart}
            description={playlist.description}
            tracks={playlist.artwork_tracks}
            coverDataUrl={playlist.cover_data_url}
            meta={[
              playlist.category || null,
              t("common.trackCount", { count: playlist.track_count }),
              playlist.follower_count > 0
                ? t("common.followerCount", {
                    count: playlist.follower_count,
                  })
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            systemPlaylist
            crateManaged
            isFollowed={playlist.is_followed}
            href={`/curation/playlist/${playlist.id}`}
            onPlay={() => onPlay(playlist.id, playlist.name)}
            onToggleFollow={() =>
              onToggleFollow(playlist.id, playlist.is_followed)
            }
            onClick={() => onOpen(playlist.id)}
          />
        ))}
      </MediaRail>
    </section>
  );
}

function getGenreSlug(genre: { slug?: string | null; name: string }): string {
  return genre.slug?.trim() || genre.name.toLowerCase().replace(/\s+/g, "-");
}

export function GenreExplorer({
  genres,
  onOpen,
}: {
  genres: BrowseFilters["genres"];
  onOpen: (genre: string) => void;
}) {
  const { t } = useTranslation();
  const topGenres = [...genres].sort((a, b) => b.count - a.count).slice(0, 12);
  if (!topGenres.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("explore.genreRooms.title")}
        subtitle={t("explore.genreRooms.subtitle")}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {topGenres.slice(0, 8).map((genre, index) => {
          const slug = getGenreSlug(genre);
          const coverUrl = resolveMaybeApiAssetUrl(genre.cover_url);
          return (
            <GenreTile
              key={genre.slug || genre.name}
              variant="room"
              slug={slug}
              name={genre.name}
              kicker={t("explore.genreRooms.badge")}
              detail={
                genre.description ||
                (genre.top_artists?.length
                  ? genre.top_artists.slice(0, 3).join(", ")
                  : null)
              }
              imageCandidates={coverUrl ? [coverUrl] : []}
              placeholderIndex={index}
              onOpen={() => onOpen(slug)}
            />
          );
        })}
      </div>
    </section>
  );
}

export function MoodBrowseSection({ moods }: { moods: MoodPreset[] }) {
  const { t } = useTranslation();
  const { playAll } = usePlayerActions();
  const [loadingMood, setLoadingMood] = useState<string | null>(null);

  async function playMood(mood: string) {
    try {
      const w = window as unknown as Record<string, AudioContext>;
      if (!w.__crateAudioCtx) w.__crateAudioCtx = new AudioContext();
      if (w.__crateAudioCtx.state === "suspended") w.__crateAudioCtx.resume();
    } catch {
      /* ok */
    }
    setLoadingMood(mood);
    try {
      const data = await api<{
        tracks: Array<{
          id: number;
          entity_uid?: string;
          title: string;
          artist: string;
          artist_id?: number;
          artist_entity_uid?: string;
          artist_slug?: string;
          album: string;
          album_id?: number;
          album_entity_uid?: string;
          album_slug?: string;
          path: string;
        }>;
      }>(`/api/browse/mood/${mood}?limit=50`);
      if (data.tracks.length > 0) {
        playAll(
          data.tracks.map((track) =>
            toPlayableTrack(track, {
              cover: albumCoverApiUrl(
                {
                  albumId: track.album_id,
                  albumEntityUid: track.album_entity_uid,
                  artistEntityUid: track.artist_entity_uid,
                  albumSlug: track.album_slug,
                  artistName: track.artist,
                  albumName: track.album,
                },
                { size: 512 },
              ),
            }),
          ),
          0,
          {
            type: "playlist",
            name: t("explore.moods.mixName", { mood: moodLabel(mood, t) }),
          },
        );
      } else {
        notify.info(t("explore.toasts.noMoodTracks"));
      }
    } catch {
      notify.error(t("explore.toasts.loadMoodTracksFailed"));
    } finally {
      setLoadingMood(null);
    }
  }

  if (moods.length === 0) return null;

  return (
    <div className="space-y-3">
      <SectionHeader
        title={t("explore.moods.title")}
        subtitle={t("explore.moods.subtitle")}
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {moods.map((mood) => (
          <button
            key={mood.name}
            type="button"
            onClick={() => void playMood(mood.name)}
            disabled={loadingMood !== null}
            className={`rounded-lg border px-4 py-3 text-left transition-colors ${
              MOOD_COLORS[mood.name] ||
              "bg-text-primary/5 text-text-primary/70 border-border-quiet"
            } active:scale-[0.98]`}
          >
            <span className="text-sm font-medium">
              {loadingMood === mood.name
                ? t("common.loadingShort")
                : moodLabel(mood.name, t)}
            </span>
            <span className="mt-0.5 block text-xs opacity-60">
              {t("common.trackCount", { count: mood.track_count })}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
