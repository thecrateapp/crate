import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

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

export { ExploreFeatureCard } from "@/components/explore/ExploreBrowseViews";
import { ExploreMoodChoices } from "@/components/explore/ExploreBrowseViews";

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

  return (
    <ExploreMoodChoices
      moods={moods}
      pending={loadingMood}
      onPlay={(mood) => void playMood(mood)}
    />
  );
}
