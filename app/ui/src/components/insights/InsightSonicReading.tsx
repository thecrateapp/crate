import { Link } from "react-router";
import { Button } from "@crate/ui/shadcn/button";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Meter } from "@crate/ui/primitives/Meter";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { InstrumentChartReadout } from "@/components/charts/InstrumentChart";
import {
  albumCoverApiUrl,
  albumPagePath,
  artistPagePath,
} from "@/lib/library-routes";
import {
  minutes,
  number,
  percent,
  type InsightsWindow,
  type SonicTrack,
} from "./insights-model";
import { useSonicNeighbors } from "./use-sonic-neighbors";

const reading = (value: number | null, unit = "") =>
  value === null ? "Unavailable" : `${number(value)}${unit ? ` ${unit}` : ""}`;
const confidence = (value: number | null) =>
  value === null ? "Unavailable" : percent(value * 100);
const albumPath = (track: SonicTrack) =>
  albumPagePath({
    albumId: track.album_id,
    albumEntityUid: track.album_entity_uid,
    albumSlug: track.album_slug,
    albumName: track.album,
    artistSlug: track.artist_slug,
    artistName: track.artist,
  });

export function SonicTrackCover({ track }: { track: SonicTrack }) {
  return (
    <MediaCover
      size={48}
      src={
        track.has_cover
          ? albumCoverApiUrl({ albumId: track.album_id }, { size: 96 })
          : null
      }
      alt=""
      fallback={track.album.slice(0, 1)}
    />
  );
}

export function InsightSonicReading({
  track,
  window,
  active = true,
}: {
  track: SonicTrack;
  window: InsightsWindow;
  active?: boolean;
}) {
  const neighbors = useSonicNeighbors(track, window, active);
  const estimates = [
    { label: "Acousticness", value: track.acousticness },
    { label: "Instrumentalness", value: track.instrumentalness },
    { label: "Valence", value: track.valence },
  ].filter((item) => item.value !== null);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div role="group" aria-label="Selected sonic track" className="min-w-0">
        <InstrumentPanel
          as="section"
          headingLevel={3}
          ruled={false}
          className="pt-0"
          label={{ tone: "accent", children: "Track reading" }}
        >
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <SonicTrackCover track={track} />
              <div className="flex min-w-0 flex-col gap-1">
                <h4 className="wrap-anywhere font-display text-lg">
                  {track.title}
                </h4>
                <MonoLabel as="p" className="wrap-anywhere">
                  {track.artist} · {track.year ?? "Year unknown"}
                </MonoLabel>
                <p className="wrap-anywhere text-sm text-text-muted">
                  {track.album}
                </p>
              </div>
            </div>
            <InstrumentChartReadout
              label="Track measurements"
              items={[
                {
                  label: "Tempo",
                  value: reading(track.bpm, "BPM"),
                  unit: `confidence ${confidence(track.bpm_confidence)}`,
                },
                { label: "Smart Mix energy", value: reading(track.energy) },
                {
                  label: "Integrated loudness",
                  value: reading(track.integrated_lufs, "LUFS"),
                },
                {
                  label: "True peak",
                  value: reading(track.true_peak_dbfs, "dBFS"),
                },
                {
                  label: "Camelot key",
                  value: track.key_camelot ?? "Unavailable",
                  unit: `confidence ${confidence(track.key_confidence)}`,
                },
                {
                  label: "Tempo stability",
                  value: reading(track.tempo_stability),
                },
                {
                  label: "Current profile",
                  value: track.quality
                    ? track.quality.charAt(0).toUpperCase() +
                      track.quality.slice(1)
                    : "Unavailable",
                },
                {
                  label: "Period listening",
                  value: track.heard
                    ? `${number(track.plays)} plays · ${minutes(track.minutes)}`
                    : "No registered plays",
                },
              ]}
            />
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary">
                <Link aria-label={`Open ${track.album}`} to={albumPath(track)}>
                  Open album
                </Link>
              </Button>
              <Button asChild variant="secondary">
                <Link
                  aria-label={`Open ${track.artist}`}
                  to={artistPagePath({
                    artistName: track.artist,
                    artistSlug: track.artist_slug,
                  })}
                >
                  Open artist
                </Link>
              </Button>
            </div>
            {estimates.length ? (
              <div className="flex min-w-0 flex-col gap-3">
                <p className="text-xs text-text-muted">
                  Estimated traits · not measured probabilities.
                </p>
                {estimates.map((item) => (
                  <Meter
                    key={item.label}
                    label={item.label}
                    value={item.value}
                    max={1}
                    valueText={number(item.value!)}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </InstrumentPanel>
      </div>
      <div role="group" aria-label="Sound nearby" className="min-w-0">
        <InstrumentPanel
          as="section"
          headingLevel={3}
          label={{ tone: "accent", children: "Sound nearby" }}
          description="Stored Bliss similarity, not mixing compatibility. Lower cosine distance means closer sound."
        >
          {!track.has_bliss ? (
            <p className="text-sm text-text-muted">
              No stored Bliss vector for this track.
            </p>
          ) : neighbors.loading ? (
            <p role="status" className="text-sm text-text-muted">
              Loading nearby sound…
            </p>
          ) : neighbors.error ? (
            <div role="status" className="flex flex-col items-start gap-2">
              <p className="text-sm text-text-muted">
                Nearby sound could not be loaded.
              </p>
              <Button variant="secondary" onClick={neighbors.retry}>
                Retry nearby sound
              </Button>
            </div>
          ) : neighbors.data?.available === false ? (
            <p className="text-sm text-text-muted">
              No valid stored Bliss vector for this track.
            </p>
          ) : neighbors.data?.items.length ? (
            <HairlineList>
              {neighbors.data.items.map(({ track: nearby, distance }) => (
                <HairlineRow key={nearby.id} asChild truncate={false}>
                  <Link
                    to={albumPath(nearby)}
                    className="group min-h-11 outline-offset-4"
                  >
                    <div className="flex min-w-0 items-start gap-3 text-text-primary group-hover:text-accent-action-hi">
                      <SonicTrackCover track={nearby} />
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="wrap-anywhere font-display">
                          {nearby.title}
                        </div>
                        <MonoLabel as="p" className="wrap-anywhere">
                          {nearby.artist} · {nearby.year ?? "Year unknown"}
                        </MonoLabel>
                        <p className="wrap-anywhere text-xs text-text-muted">
                          Cosine distance{" "}
                          {new Intl.NumberFormat("en", {
                            maximumFractionDigits: 3,
                          }).format(distance)}{" "}
                          ·{" "}
                          {nearby.heard
                            ? `${number(nearby.plays)} registered plays`
                            : "No plays in this period"}
                        </p>
                      </div>
                    </div>
                  </Link>
                </HairlineRow>
              ))}
            </HairlineList>
          ) : (
            <p className="text-sm text-text-muted">
              No eligible nearby tracks found.
            </p>
          )}
        </InstrumentPanel>
      </div>
    </div>
  );
}
