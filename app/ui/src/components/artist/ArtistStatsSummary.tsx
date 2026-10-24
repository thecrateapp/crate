import { Meter } from "@crate/ui/primitives/Meter";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import type { ArtistData } from "./artistPageTypes";
import {
  artistAnalysisReadout,
  catalogueReadout,
  catalogueTrackCount,
  durationReading,
  predominantGenre,
  type ArtistAnalysisTrack,
  type ArtistStatsData,
} from "./artist-stats-model";

export interface ArtistStatsCapabilities {
  smart_mix?: { available?: boolean };
}

interface ReadState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function ArtistStatsSummary({
  data,
  totalTracks,
  genreProfile,
  analysis,
  capabilities,
}: {
  data: ArtistStatsData;
  totalTracks?: number;
  genreProfile?: ArtistData["genre_profile"];
  analysis: ReadState<Record<string, ArtistAnalysisTrack>>;
  capabilities: ReadState<ArtistStatsCapabilities>;
}) {
  const catalogue = catalogueReadout(data.albums_timeline);
  const tracks = catalogueTrackCount(data.albums_timeline, totalTracks);
  const readings =
    analysis.data && !analysis.loading && !analysis.error
      ? artistAnalysisReadout(analysis.data)
      : null;
  const audioState = analysis.loading ? "Loading" : "Unavailable";
  const mixState = capabilities.loading
    ? "Loading"
    : capabilities.error || capabilities.data?.smart_mix?.available == null
      ? "Unavailable"
      : capabilities.data.smart_mix.available === false
        ? "Disabled"
        : readings
          ? null
          : audioState;
  const coverage = (count: number | null | undefined) =>
    count != null &&
    tracks != null &&
    tracks > 0 &&
    count <= tracks &&
    readings != null &&
    readings.uniqueTracks > 0 &&
    readings.uniqueTracks <= tracks
      ? Math.round((count / tracks) * 100)
      : null;
  const mixPercent = mixState ? null : coverage(readings?.smartMixTracks);
  const blissPercent = coverage(readings?.blissTracks);
  const range =
    catalogue.firstYear == null
      ? "Unavailable"
      : catalogue.firstYear === catalogue.lastYear
        ? String(catalogue.firstYear)
        : `${catalogue.firstYear}–${catalogue.lastYear}`;
  const metrics = [
    { label: "Local albums", value: data.albums_timeline.length },
    { label: "Tracks", value: tracks ?? "Unavailable" },
    { label: "Available duration", value: durationReading(catalogue.duration) },
    { label: "Publication range", value: range },
    {
      label: "Predominant genre",
      value: predominantGenre(genreProfile, data.genres) ?? "Unavailable",
      helper: "Strongest editorial tag",
    },
    {
      label: "Mean BPM",
      value:
        readings?.meanBpm != null ? Math.round(readings.meanBpm) : audioState,
      helper: readings
        ? `${readings.measuredTracks} / ${tracks ?? "unknown"} tracks measured`
        : analysis.loading
          ? "Loading track measurements"
          : "Track measurements unavailable",
    },
    {
      label: "Full Smart Mix coverage",
      value:
        mixPercent == null ? (mixState ?? "Unavailable") : `${mixPercent}%`,
      helper:
        mixState === "Disabled"
          ? "Smart Mix is disabled on this server"
          : mixPercent == null
            ? "Current Full profiles unavailable"
            : undefined,
      count: mixPercent == null ? undefined : readings?.smartMixTracks,
      railLabel: "Current Full",
    },
    {
      label: "Bliss coverage",
      value:
        blissPercent == null
          ? readings
            ? "Unavailable"
            : audioState
          : `${blissPercent}%`,
      helper: blissPercent == null ? "Stored vectors unavailable" : undefined,
      count: blissPercent == null ? undefined : readings?.blissTracks,
      railLabel: "Stored vectors",
    },
  ];
  return (
    <section
      aria-label="Artist catalogue summary"
      className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4"
    >
      {metrics.map(({ label, value, helper, count, railLabel }) => (
        <div
          key={label}
          role="group"
          aria-label={label}
          className="min-w-0 space-y-3"
        >
          <StatNumber
            as="div"
            size="sm"
            label={label}
            className="min-w-0 max-w-full [&>span]:min-w-0 [&>span]:max-w-full [&>span>span]:min-w-0 [&>span>span]:max-w-full"
            value={<span className="block wrap-anywhere">{value}</span>}
          />
          {count != null && tracks != null && railLabel ? (
            <Meter
              label={railLabel}
              value={count}
              max={tracks}
              valueText={`${count} / ${tracks}`}
            />
          ) : helper ? (
            <MonoLabel as="p" className="wrap-anywhere">
              {helper}
            </MonoLabel>
          ) : null}
        </div>
      ))}
    </section>
  );
}
