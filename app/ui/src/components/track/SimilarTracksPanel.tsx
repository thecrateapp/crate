import { useState, useEffect } from "react";
import { Link } from "react-router";
import { AppModal, ModalBody } from "@crate/ui/primitives/AppModal";
import { LoadingState, EmptyState } from "@crate/ui/domain/states";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { api } from "@/lib/api";
import { albumPagePath, artistPagePath } from "@/lib/library-routes";

interface SimilarTrack {
  track_id?: number;
  track_slug?: string;
  path: string;
  title: string;
  artist: string;
  artist_id?: number;
  artist_slug?: string;
  album: string;
  album_id?: number;
  album_slug?: string;
  duration: number;
  score: number | null;
}

interface SimilarTracksPanelProps {
  trackPath: string;
  trackTitle: string;
  artist: string;
  open: boolean;
  onClose: () => void;
}

export function SimilarTracksPanel({
  trackPath,
  trackTitle,
  artist,
  open,
  onClose,
}: SimilarTracksPanelProps) {
  const [tracks, setTracks] = useState<SimilarTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open || !trackPath) return;
    let active = true;
    setLoading(true);
    setError(null);
    setTracks([]);
    api<{ tracks: SimilarTrack[] }>(
      `/api/similar-tracks?path=${encodeURIComponent(trackPath)}&limit=20`,
    )
      .then((data) => {
        if (active) setTracks(data.tracks ?? []);
      })
      .catch(() => {
        if (active) setError("Similar tracks could not be loaded. Try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, trackPath, attempt]);
  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={<span className="wrap-anywhere">Similar to {trackTitle}</span>}
      description={artist}
      closeLabel="Close similar tracks"
      size="md"
      panelClassName="max-h-[calc(100dvh-2rem)]"
      headerClassName="shrink-0"
      mobileSafeArea
    >
      <ModalBody className="p-5">
        {loading ? (
          <LoadingState label="Loading similar tracks" />
        ) : error ? (
          <ErrorState
            message={error}
            onRetry={() => setAttempt((value) => value + 1)}
          />
        ) : tracks.length === 0 ? (
          <EmptyState message="No similar tracks found" />
        ) : (
          <HairlineList label="Similar tracks" ruled={false}>
            {tracks.map((track, index) => {
              const href = track.album
                ? albumPagePath({
                    albumId: track.album_id,
                    albumSlug: track.album_slug,
                    artistName: track.artist,
                    albumName: track.album,
                  })
                : artistPagePath({
                    artistId: track.artist_id,
                    artistSlug: track.artist_slug,
                    artistName: track.artist,
                  });
              return (
                <HairlineRow
                  key={
                    track.path ||
                    `${track.artist}-${track.album}-${track.title}`
                  }
                  index={index + 1}
                  asChild
                  truncate={false}
                  trailing={
                    track.score != null ? (
                      <InfoBadge>{Math.round(track.score * 100)}%</InfoBadge>
                    ) : undefined
                  }
                >
                  <Link
                    to={href}
                    onClick={onClose}
                    className="hover:text-accent-action-hi focus-visible:outline-2 focus-visible:outline-focus-ring"
                  >
                    <span className="block">{track.title || "Unknown"}</span>
                    <MonoLabel
                      as="span"
                      className="mt-1 block"
                      meta={[track.artist, track.album]}
                    />
                  </Link>
                </HairlineRow>
              );
            })}
          </HairlineList>
        )}
      </ModalBody>
    </AppModal>
  );
}
