import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  Disc3,
  Pencil,
  Play,
  Share2,
  Shuffle,
} from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import { CrateEditor } from "@/components/CrateEditor";
import { CrateImage } from "@/components/artwork/CrateImage";
import { CrateLoader } from "@/components/ui/CrateLoader";
import { useApi } from "@/hooks/use-api";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { albumCoverApiUrl, albumPagePath } from "@/lib/library-routes";
import { publicShareUrl } from "@/lib/share-url";
import { openShareSheet } from "@/lib/social-share";
import { shuffleArray } from "@/lib/utils";
import { toPlayableTrack } from "@/lib/playable-track";
import type { CrateDetail, CratePlaybackTrack } from "@/pages/crates-types";

export function Crate() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { crateId } = useParams<{ crateId: string }>();
  const { data, loading, refetch } = useApi<CrateDetail>(
    crateId ? `/api/crates/${crateId}` : null,
  );
  const { data: playbackData, loading: playbackLoading } = useApi<
    CratePlaybackTrack[]
  >(crateId ? `/api/crates/${crateId}/playback` : null);
  const { playAll } = usePlayerActions();
  const [editing, setEditing] = useState(false);
  const canEdit = data?.access === "owner" || data?.access === "collaborator";
  const playerTracks = useMemo<Track[]>(
    () =>
      (playbackData ?? []).map((track) =>
        toPlayableTrack(
          {
            id: track.local_track_id ?? track.global_track_uid,
            globalTrackUid: track.global_track_uid,
            globalAlbumUid: track.global_album_uid,
            globalArtistUid: track.global_artist_uid,
            entity_uid: track.local_track_entity_uid,
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration: track.duration,
            libraryTrackId: track.local_track_id,
          },
          {
            cover: albumCoverApiUrl(
              {
                globalAlbumUid: track.global_album_uid,
                albumName: track.album,
                artistName: track.artist,
              },
              { size: 512 },
            ),
          },
        ),
      ),
    [playbackData],
  );
  const canPlay = !playbackLoading && playerTracks.length > 0;

  function startCratePlayback(tracks: Track[]) {
    if (!data || tracks.length === 0) return;
    playAll(tracks, 0, {
      type: "crate",
      name: data.name,
      id: data.id,
      href: `/crate/${data.id}`,
    });
  }

  if (editing && data && canEdit) {
    return (
      <CrateEditor
        crateId={data.id}
        onBack={() => {
          setEditing(false);
          refetch();
        }}
        onCreated={() => {}}
        onDeleted={() => navigate("/collection?tab=crates", { replace: true })}
      />
    );
  }

  if (loading && !data) {
    return <CrateLoader label={t("crate.page.loading")} />;
  }

  if (!data) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 py-16 text-center">
        <Disc3 size={28} className="text-accent-action" />
        <p className="text-lg font-semibold text-text-primary">
          {t("crate.page.notFound")}
        </p>
        <Link
          to="/collection?tab=crates"
          className="inline-flex items-center gap-2 text-sm text-accent-action hover:underline"
        >
          <ArrowLeft size={15} />
          {t("crate.page.backToCollection")}
        </Link>
      </div>
    );
  }

  const ownerName =
    data.owner_name || data.owner_username || t("people.unknownUser");
  const firstAlbum = data.albums[0];
  const coverUrl = firstAlbum?.has_cover
    ? albumCoverApiUrl(
        {
          globalAlbumUid: firstAlbum.global_album_uid,
          albumName: firstAlbum.name,
          artistName: firstAlbum.artist_name,
        },
        { size: 768 },
      )
    : null;
  function shareCrate() {
    const crate = data;
    if (!crate || crate.visibility !== "public") return;
    openShareSheet({
      kind: "crate",
      title: crate.name,
      subtitle: ownerName,
      imageUrl: coverUrl,
      url: publicShareUrl(`/share/crate/${encodeURIComponent(crate.id)}`),
    });
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-8 pb-12">
      <section className="grid gap-6 overflow-hidden rounded-xl border border-border-quiet bg-text-primary/[0.035] p-5 sm:p-7 md:grid-cols-[minmax(200px,300px)_1fr] md:items-center">
        <div className="aspect-square overflow-hidden rounded-xl border border-border-quiet bg-text-primary/[0.04]">
          {coverUrl ? (
            <CrateImage
              src={coverUrl}
              alt={firstAlbum?.name ?? ""}
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center bg-gradient-to-br from-accent-action/15 via-text-primary/[0.03] to-surface-canvas/20 text-accent-action/80">
              <Disc3 size={64} strokeWidth={1.2} />
            </div>
          )}
        </div>

        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent-action">
            {t("crate.page.kicker", { name: ownerName })}
          </p>
          <h1 className="mt-3 break-words text-3xl font-black leading-tight text-text-primary sm:text-5xl">
            {data.name}
          </h1>
          {data.description ? (
            <p className="mt-4 max-w-2xl whitespace-pre-wrap text-sm leading-6 text-text-muted sm:text-base">
              {data.description}
            </p>
          ) : null}
          <p className="mt-4 text-sm text-text-muted">
            {t("common.albumCountLabel", { count: data.albums.length })}
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => startCratePlayback(playerTracks)}
              disabled={!canPlay}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent-action px-4 py-2.5 text-sm font-semibold text-accent-action-foreground transition-colors hover:bg-accent-action/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play size={16} fill="currentColor" />
              {t("crate.page.play")}
            </button>
            <button
              type="button"
              onClick={() => startCratePlayback(shuffleArray(playerTracks))}
              disabled={!canPlay}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border-quiet bg-text-primary/[0.04] px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-text-primary/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Shuffle size={16} />
              {t("crate.page.shuffle")}
            </button>
            {data.visibility === "public" ? (
              <button
                type="button"
                onClick={shareCrate}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent-action px-4 py-2.5 text-sm font-semibold text-accent-action-foreground transition-colors hover:bg-accent-action/90"
              >
                <Share2 size={16} />
                {t("crate.page.share")}
              </button>
            ) : null}
            {canEdit ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border-quiet bg-text-primary/[0.04] px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-text-primary/[0.08]"
              >
                <Pencil size={15} />
                {t("crate.page.edit")}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-bold text-text-primary">
            {t("crate.page.albums")}
          </h2>
          <span className="text-sm text-text-muted">
            {t("common.albumCountLabel", { count: data.albums.length })}
          </span>
        </div>
        {data.albums.length > 0 ? (
          <ol className="divide-y divide-text-primary/6 overflow-hidden rounded-xl border border-border-quiet bg-text-primary/[0.025]">
            {data.albums.map((album, index) => {
              const albumCover = album.has_cover
                ? albumCoverApiUrl(
                    {
                      globalAlbumUid: album.global_album_uid,
                      albumName: album.name,
                      artistName: album.artist_name,
                    },
                    { size: 192 },
                  )
                : null;

              return (
                <li key={album.global_album_uid}>
                  <Link
                    to={albumPagePath({
                      globalAlbumUid: album.global_album_uid,
                      albumName: album.name,
                      artistName: album.artist_name,
                    })}
                    className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-text-primary/[0.04] sm:px-5"
                  >
                    <span className="w-7 shrink-0 text-right text-xs tabular-nums text-text-muted">
                      {index + 1}
                    </span>
                    <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-text-primary/[0.05]">
                      {albumCover ? (
                        <CrateImage
                          src={albumCover}
                          alt=""
                          loading="lazy"
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center text-accent-action/60">
                          <Disc3 size={22} />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-text-primary sm:text-base">
                        {album.name}
                      </p>
                      <p className="mt-1 truncate text-sm text-text-muted">
                        {album.artist_name}
                        {album.year ? ` · ${album.year}` : ""}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="rounded-xl border border-dashed border-border-quiet px-5 py-12 text-center text-sm text-text-muted">
            {t("crate.page.noAlbums")}
          </div>
        )}
      </section>
    </main>
  );
}
