import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { ResponsiveScatterPlot } from "@nivo/scatterplot";
import { Bar } from "@nivo/bar";
import { useApi } from "@/hooks/use-api";
import { useMotionAllowed } from "@crate/ui/lib/motion-gate";
import { FilterChip } from "@crate/ui/primitives/FilterChip";
import { Button } from "@crate/ui/shadcn/button";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { Meter } from "@crate/ui/primitives/Meter";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { artistActionApiPath } from "@/lib/library-routes";
import {
  InstrumentChartPoint,
  InstrumentChartReadout,
  useInstrumentChartTheme,
} from "@/components/charts/InstrumentChart";
import type { ArtistData } from "./artistPageTypes";
import { ArtistDetailSection } from "./ArtistDetailSection";
import {
  ArtistStatsSummary,
  type ArtistStatsCapabilities,
} from "./ArtistStatsSummary";
import {
  audioObservations,
  albumObservationMetadata,
  available,
  durationReading,
  formatShares,
  nearestObservation,
  matchAlbumObservation,
  mostRecentObservationId,
  type AudioObservation,
  rankAlbums,
  releaseObservations,
  type ArtistStatsData,
  type ArtistAnalysisTrack,
} from "./artist-stats-model";

export function ArtistStats({
  artistId,
  artistEntityUid,
  catalogueAlbums,
  totalTracks,
  genreProfile,
}: {
  artistId?: number;
  artistEntityUid?: string;
  catalogueAlbums?: ArtistData["albums"];
  totalTracks?: number;
  genreProfile?: ArtistData["genre_profile"];
}) {
  const { data, loading, error, refetch } = useApi<ArtistStatsData>(
    artistActionApiPath({ artistId, artistEntityUid }, "stats") || null,
  );
  const analysis = useApi<Record<string, ArtistAnalysisTrack>>(
    artistActionApiPath({ artistId, artistEntityUid }, "analysis-data") || null,
  );
  const capabilities = useApi<ArtistStatsCapabilities>("/api/capabilities");
  if (loading) return <LoadingState label="Loading stats" />;
  if (error)
    return (
      <ErrorState
        message="Artist statistics could not be loaded."
        onRetry={refetch}
      />
    );
  if (!data)
    return (
      <EmptyState
        title="No statistics available"
        description="Statistics will appear when library and enrichment data are available."
      />
    );
  const hasObservations = [
    data.formats,
    data.albums_timeline,
    data.audio_by_album,
    data.top_tracks_by_popularity,
  ].some((rows) => rows.length);
  return (
    <div className="space-y-8">
      <ArtistStatsSummary
        data={data}
        totalTracks={totalTracks}
        genreProfile={genreProfile}
        analysis={analysis}
        capabilities={capabilities}
      />
      {hasObservations ? (
        <ArtistStatsConsole
          key={JSON.stringify(data)}
          data={data}
          catalogueAlbums={catalogueAlbums}
        />
      ) : (
        <EmptyState
          title="No statistics available"
          description="Statistics will appear when library and enrichment data are available."
        />
      )}
    </div>
  );
}

function ArtistStatsConsole({
  data,
  catalogueAlbums,
}: {
  data: ArtistStatsData;
  catalogueAlbums?: ArtistData["albums"];
}) {
  const { colors } = useInstrumentChartTheme();
  const releases = releaseObservations(data.albums_timeline);
  const audio = audioObservations(data.audio_by_album);
  const releaseMetadata = albumObservationMetadata(
    releases.map((row) => ({ id: row.id, title: row.name, year: row.year })),
    catalogueAlbums,
  );
  const audioMetadata = albumObservationMetadata(
    audio.map((row) => ({ id: row.id, title: row.album, year: row.year })),
    catalogueAlbums,
  );
  const [releaseId, setReleaseId] = useState(mostRecentObservationId(releases));
  const [audioId, setAudioId] = useState(
    mostRecentObservationId(
      audio.map((row, index) => ({
        id: row.id,
        year: row.year ?? audioMetadata[index]?.year,
      })),
    ),
  );
  const [albumUnit, setAlbumUnit] = useState<"popularity" | "lastfm_listeners">(
    "popularity",
  );
  const release = releases.find((row) => row.id === releaseId);
  const observation = audio.find((row) => row.id === audioId);
  const formats = formatShares(data.formats);
  const releaseIdentity = releaseMetadata.find(
    (item) => item.value === releaseId,
  );
  const audioIdentity = audioMetadata.find((item) => item.value === audioId);
  const releaseAudio =
    release &&
    releases.filter(
      (row) => row.name === release.name && row.yearValue === release.yearValue,
    ).length === 1
      ? matchAlbumObservation(
          release.name,
          release.year,
          audio,
          (row) => row.album,
        )
      : undefined;
  const audioRelease = observation
    ? matchAlbumObservation(
        observation.album,
        observation.year,
        releases,
        (row) => row.name,
      )
    : undefined;
  const tracks = data.top_tracks_by_popularity
    .map((row, index) => ({
      ...row,
      id: `track-${index}`,
      label: row.title,
      value:
        row.popularity_score != null
          ? Math.round(row.popularity_score * 100)
          : row.popularity,
    }))
    .filter((row): row is typeof row & { value: number } =>
      available(row.value),
    )
    .sort((a, b) => b.value - a.value);
  const albums = rankAlbums(data.albums_timeline, albumUnit);
  const listenerMax = Math.max(0, ...albums.map((album) => album.value));
  const listenerScaleMax = Math.max(1, listenerMax);
  const knownYears = releases.filter((row) => row.yearValue != null);
  const undated = releases.filter((row) => row.yearValue == null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [timelineWidth, setTimelineWidth] = useState(640);
  useEffect(() => {
    const container = timelineRef.current;
    if (!container) return;
    const update = (width: number) => {
      if (width > 0) setTimelineWidth(width);
    };
    update(container.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) update(entries[0].contentRect.width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const height = Math.max(
    140,
    90 + Math.max(0, ...knownYears.map((row) => row.lane)) * 48,
  );
  const timelinePoints = knownYears.map((row) => ({
    ...row,
    x: 28 + row.position! * Math.max(0, timelineWidth - 56),
    y: height - 57 - row.lane * 48,
  }));
  const inspectTimeline = (
    event: MouseEvent<SVGRectElement> | PointerEvent<SVGRectElement>,
  ) => {
    const box = event.currentTarget.getBoundingClientRect();
    const point = nearestObservation(
      timelinePoints,
      (event.clientX - box.left) * (box.width ? timelineWidth / box.width : 1),
      event.clientY - box.top,
      releaseId,
    );
    if (point) setReleaseId(point.id);
  };
  return (
    <div className="space-y-8">
      {!!releases.length && (
        <>
          <ArtistDetailSection headingLevel={3} title="Release timeline">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(180px,1fr)]">
              <div ref={timelineRef} className="min-w-0">
                {knownYears.length > 0 && (
                  <svg
                    data-admin-instrument="artist-release-timeline"
                    role="group"
                    aria-label="Chronological releases"
                    viewBox={`0 0 ${timelineWidth} ${height}`}
                    width={timelineWidth}
                    height={height}
                    className="w-full"
                  >
                    <line
                      x1={28}
                      x2={timelineWidth - 28}
                      y1={height - 40}
                      y2={height - 40}
                      stroke={colors.border}
                    />
                    {[...new Set(knownYears.map((row) => row.yearValue!))]
                      .sort((a, b) => a - b)
                      .filter(
                        (_, index, years) =>
                          index === 0 || index === years.length - 1,
                      )
                      .sort((a, b) => a - b)
                      .map((year) => {
                        const position = knownYears.find(
                          (row) => row.yearValue === year,
                        )!.position!;
                        return (
                          <text
                            key={year}
                            x={28 + position * Math.max(0, timelineWidth - 56)}
                            y={height - 14}
                            textAnchor="middle"
                            fill={colors.subtle}
                            fontSize={11}
                            fontFamily="var(--font-mono-stack)"
                          >
                            {year}
                          </text>
                        );
                      })}
                    {timelinePoints.map((row) => {
                      const { x, y } = row;
                      return (
                        <g key={row.id}>
                          <line
                            x1={x}
                            x2={x}
                            y1={y}
                            y2={height - 40}
                            stroke={colors.border}
                          />
                          <g
                            role="button"
                            pointerEvents="none"
                            tabIndex={0}
                            aria-label={`Inspect ${row.name}, ${row.yearValue}, ${row.track_count} tracks${observationOrdinal(timelinePoints, row.id, (item) => `${item.name}:${item.yearValue}:${item.track_count}`)}`}
                            aria-pressed={releaseId === row.id}
                            onFocus={() => setReleaseId(row.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setReleaseId(row.id);
                              }
                            }}
                          >
                            <InstrumentChartPoint
                              x={x}
                              y={y}
                              size={9}
                              color={colors.accent}
                              selected={releaseId === row.id}
                              muted={releaseId !== row.id}
                            />
                          </g>
                        </g>
                      );
                    })}
                    <rect
                      data-testid="release-interaction"
                      aria-hidden="true"
                      width={timelineWidth}
                      height={height - 35}
                      fill="transparent"
                      pointerEvents="all"
                      onPointerMove={inspectTimeline}
                      onClick={inspectTimeline}
                    />
                  </svg>
                )}
                {!!undated.length && (
                  <ObservationRail
                    label="Undated releases"
                    rows={undated.map((row) => ({
                      id: row.id,
                      title: row.name,
                    }))}
                    selectedId={releaseId}
                    onSelect={setReleaseId}
                  />
                )}
              </div>
              {release && (
                <AlbumInspector
                  label="Release reading"
                  title={release.name}
                  coverUrl={releaseIdentity?.coverUrl}
                  year={releaseIdentity?.year}
                  trackCount={release.track_count}
                  duration={release.total_duration}
                  audio={releaseAudio}
                />
              )}
            </div>
          </ArtistDetailSection>
        </>
      )}
      {!!audio.length && (
        <ArtistDetailSection
          headingLevel={3}
          title="Sonic map"
          ruled={!!releases.length}
          description="Means of available analyzed samples with BPM present, grouped by album name/year. Sample counts and complete coverage are unavailable. Loudness estimate varies by analyzer."
        >
          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(180px,1fr)]">
            <SonicPlot
              rows={audio}
              selectedId={audioId}
              onSelect={setAudioId}
            />
            {observation && (
              <AlbumInspector
                label="Audio reading"
                title={observation.album}
                coverUrl={audioIdentity?.coverUrl}
                year={audioIdentity?.year}
                trackCount={audioRelease?.track_count}
                duration={audioRelease?.total_duration}
                audio={observation}
              />
            )}
          </div>
        </ArtistDetailSection>
      )}
      {(data.top_tracks_by_popularity.length > 0 || releases.length > 0) && (
        <div className="grid min-w-0 gap-8 md:grid-cols-2">
          {!!data.top_tracks_by_popularity.length && (
            <ArtistDetailSection
              headingLevel={3}
              title="Track rankings"
              actions={
                <span className="inline-flex min-h-10 items-center font-mono text-xs text-text-subtle">
                  Popularity · 0–100
                </span>
              }
              ruled={!!releases.length || !!audio.length}
            >
              <p className="mb-3 min-h-10 font-mono text-xs text-text-subtle">
                Consolidated popularity · top ten selected by popularity
              </p>
              {!tracks.length && (
                <p className="text-sm text-text-subtle">
                  No available popularity readings.
                </p>
              )}
              <HairlineList>
                {tracks.map((row) => {
                  const release = matchAlbumObservation(
                    row.album,
                    undefined,
                    releases,
                    (release) => release.name,
                  );
                  const identity = albumObservationMetadata(
                    [{ id: row.id, title: row.album, year: release?.year }],
                    catalogueAlbums,
                  )[0];
                  return (
                    <HairlineRow
                      key={row.id}
                      truncate={false}
                      trailing={
                        <div className="flex flex-col items-end gap-1">
                          <RankingPlot row={row} max={100} />
                          <span className="font-mono">{row.value}/100</span>
                        </div>
                      }
                    >
                      <span className="flex min-w-0 items-start gap-3">
                        <MediaCover
                          src={identity?.coverUrl}
                          alt=""
                          fallback={row.album.slice(0, 2)}
                          className="size-12 shrink-0"
                        />
                        <span className="min-w-0 break-words">
                          <span className="font-display text-sm">
                            {row.title}
                          </span>
                          <span className="mt-1 block font-mono text-xs text-text-subtle">
                            {row.album} · {identity?.year ?? "Unknown year"}
                          </span>
                          <span className="mt-1 block font-mono text-xs text-text-subtle">
                            {available(row.duration)
                              ? `${Math.floor(row.duration / 60)}:${String(Math.floor(row.duration % 60)).padStart(2, "0")} · `
                              : ""}
                            {available(row.bpm) ? `${row.bpm} BPM · ` : ""}
                            Last.fm listeners{" "}
                            {row.lastfm_listeners ?? "Unavailable"}
                          </span>
                        </span>
                      </span>
                    </HairlineRow>
                  );
                })}
              </HairlineList>
            </ArtistDetailSection>
          )}
          {!!releases.length && (
            <ArtistDetailSection
              headingLevel={3}
              title="Album rankings"
              ruled={!!releases.length || !!audio.length}
              actions={
                <div
                  role="group"
                  aria-label="Album ranking unit"
                  className="flex flex-wrap gap-2"
                >
                  <FilterChip
                    active={albumUnit === "popularity"}
                    onClick={() => setAlbumUnit("popularity")}
                  >
                    Popularity
                  </FilterChip>
                  <FilterChip
                    active={albumUnit === "lastfm_listeners"}
                    onClick={() => setAlbumUnit("lastfm_listeners")}
                  >
                    Last.fm listeners
                  </FilterChip>
                </div>
              }
            >
              <p className="mb-3 min-h-10 font-mono text-xs text-text-subtle">
                {albumUnit === "popularity"
                  ? "Popularity · 0–100"
                  : `Last.fm listeners · max ${listenerMax.toLocaleString()}`}
              </p>
              {albums.length ? (
                <>
                  <HairlineList>
                    {albums.map((row) => {
                      const release = releases.find(
                        (release) => release.id === row.id,
                      )!;
                      const identity = releaseMetadata.find(
                        (item) => item.value === row.id,
                      );
                      return (
                        <HairlineRow
                          key={row.id}
                          truncate={false}
                          trailing={
                            <div className="flex flex-col items-end gap-1">
                              <RankingPlot
                                row={row}
                                max={
                                  albumUnit === "popularity"
                                    ? 100
                                    : listenerScaleMax
                                }
                              />
                              <span className="font-mono">
                                {albumUnit === "popularity"
                                  ? `${row.value}/100`
                                  : `${row.value.toLocaleString()} / ${listenerMax.toLocaleString()} max`}
                              </span>
                            </div>
                          }
                        >
                          <span className="flex min-w-0 items-start gap-3">
                            <MediaCover
                              src={identity?.coverUrl}
                              alt=""
                              fallback={row.label.slice(0, 2)}
                              className="size-12 shrink-0"
                            />
                            <span className="min-w-0 break-words">
                              <span className="font-display text-sm">
                                {row.label}
                              </span>
                              <span className="mt-1 block font-mono text-xs text-text-subtle">
                                {identity?.year ?? "Unknown year"} ·{" "}
                                {release.track_count} tracks
                              </span>
                              <span className="mt-1 block font-mono text-xs text-text-subtle">
                                {durationReading(release.total_duration)}
                              </span>
                            </span>
                          </span>
                        </HairlineRow>
                      );
                    })}
                  </HairlineList>
                </>
              ) : (
                <p className="text-sm text-text-subtle">
                  No available readings for this unit.
                </p>
              )}
            </ArtistDetailSection>
          )}
        </div>
      )}
      {!!formats.length && (
        <ArtistDetailSection
          headingLevel={3}
          title="Formats"
          ruled={
            !!releases.length ||
            !!audio.length ||
            !!data.top_tracks_by_popularity.length
          }
        >
          <div className="flex h-px w-full gap-1" aria-hidden="true">
            {formats.map((row, index) => (
              <span
                key={`${row.id}-${index}`}
                style={{
                  flex: row.share,
                  background: [colors.accent, colors.secondary, colors.subtle][
                    index % 3
                  ],
                }}
              />
            ))}
          </div>
          <p className="my-3 font-mono text-xs text-text-subtle">
            Known-format tracks only ·{" "}
            {formats.reduce((sum, row) => sum + row.value, 0)} tracks
          </p>
          <HairlineList>
            {formats.map((row, index) => (
              <HairlineRow
                key={`${row.id}-${index}`}
                trailing={
                  <span className="font-mono">
                    {row.value} · <span>{Math.round(row.share * 100)}%</span>
                  </span>
                }
              >
                {row.id}
              </HairlineRow>
            ))}
          </HairlineList>
        </ArtistDetailSection>
      )}
    </div>
  );
}

function SonicPlot({
  rows,
  selectedId,
  onSelect,
}: {
  rows: ReturnType<typeof audioObservations>;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const { colors, theme } = useInstrumentChartTheme();
  const motion = useMotionAllowed();
  const points = rows
    .filter((row) => row.plottable)
    .map((row) => ({
      x: row.avg_bpm!,
      y: row.avg_energy!,
      id: row.id,
      album: row.album,
    }));
  const incomplete = rows.filter((row) => !row.plottable);
  const overlapping = points.filter((point) =>
    points.some(
      (other) =>
        other.id !== point.id && other.x === point.x && other.y === point.y,
    ),
  );
  return (
    <div
      className="min-w-0"
      role="group"
      aria-label="BPM and energy observations"
    >
      <div className="h-[300px]">
        {points.length ? (
          <ResponsiveScatterPlot
            role="group"
            ariaLabel="Sonic chart nodes"
            data={[{ id: "Albums", data: points }]}
            margin={{ top: 20, right: 24, bottom: 48, left: 50 }}
            xScale={{
              type: "linear",
              min: Math.max(
                0,
                Math.min(...points.map((point) => point.x)) - 10,
              ),
              max: Math.max(...points.map((point) => point.x)) + 10,
            }}
            yScale={{ type: "linear", min: 0, max: 1 }}
            axisBottom={{
              legend: "BPM",
              legendOffset: 35,
              legendPosition: "middle",
              tickSize: 0,
              tickPadding: 10,
              tickValues: 4,
            }}
            axisLeft={{
              legend: "Energy",
              legendOffset: -38,
              legendPosition: "middle",
              tickSize: 0,
              tickPadding: 8,
              tickValues: [0, 0.5, 1],
            }}
            enableGridX={false}
            gridYValues={[0, 0.5, 1]}
            colors={[colors.accent]}
            theme={theme}
            animate={motion}
            isInteractive={false}
            nodeSize={8}
            layers={[
              "grid",
              "axes",
              "nodes",
              ({ nodes, innerWidth, innerHeight }) => {
                const inspect = (
                  event:
                    MouseEvent<SVGRectElement> | PointerEvent<SVGRectElement>,
                ) => {
                  const box = event.currentTarget.getBoundingClientRect();
                  const point = nearestObservation(
                    nodes.map((node) => ({
                      id: String(node.data.id),
                      x: node.x,
                      y: node.y,
                    })),
                    (event.clientX - box.left) *
                      (box.width ? innerWidth / box.width : 1),
                    (event.clientY - box.top) *
                      (box.height ? innerHeight / box.height : 1),
                    selectedId,
                  );
                  if (!point) return;
                  if (event.type === "click") {
                    const coincident = nodes.filter(
                      (node) => node.x === point.x && node.y === point.y,
                    );
                    if (coincident.length > 1) {
                      const selectedIndex = coincident.findIndex(
                        (node) => String(node.data.id) === selectedId,
                      );
                      onSelect(
                        String(
                          coincident[(selectedIndex + 1) % coincident.length]!
                            .data.id,
                        ),
                      );
                      return;
                    }
                  }
                  onSelect(point.id);
                };
                return (
                  <rect
                    key="inspection"
                    data-testid="sonic-interaction"
                    aria-hidden="true"
                    width={innerWidth}
                    height={innerHeight}
                    fill="transparent"
                    pointerEvents="all"
                    onPointerMove={inspect}
                    onClick={inspect}
                  />
                );
              },
            ]}
            nodeComponent={({ node }) => (
              <g
                role="button"
                pointerEvents="none"
                tabIndex={0}
                aria-label={`Inspect audio ${node.data.album}${observationOrdinal(points, String(node.data.id), (point) => point.album)}`}
                aria-pressed={node.data.id === selectedId}
                onFocus={() => onSelect(String(node.data.id))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(String(node.data.id));
                  }
                }}
              >
                <InstrumentChartPoint
                  x={node.x}
                  y={node.y}
                  size={8}
                  color={colors.accent}
                  selected={node.data.id === selectedId}
                  muted={node.data.id !== selectedId}
                />
              </g>
            )}
          />
        ) : (
          <EmptyState
            title="No plottable observations"
            description="Available traits remain in the incomplete observations below."
          />
        )}
      </div>
      {!!incomplete.length && (
        <ObservationRail
          label="Incomplete audio observations"
          rows={incomplete.map((row) => ({ id: row.id, title: row.album }))}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      )}
      {!!overlapping.length && (
        <ObservationRail
          label="Overlapping audio observations"
          rows={overlapping.map((point) => ({
            id: point.id,
            title: point.album,
          }))}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}

function ObservationRail({
  label,
  rows,
  selectedId,
  onSelect,
}: {
  label: string;
  rows: { id: string; title: string }[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="mt-3 min-w-0">
      <p className="font-mono text-xs text-text-subtle">
        {label} · {rows.length}
      </p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {rows.map((row) => (
          <Button
            key={row.id}
            variant="ghost"
            aria-label={`Inspect ${row.title} in ${label.toLowerCase()}${observationOrdinal(rows, row.id, (item) => item.title)}`}
            aria-pressed={row.id === selectedId}
            onFocus={() => onSelect(row.id)}
            onClick={() => onSelect(row.id)}
            className="h-auto min-w-0 max-w-48 justify-start whitespace-normal px-2 py-1 text-left text-xs"
          >
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-full ${row.id === selectedId ? "bg-accent-action" : "bg-text-subtle"}`}
            />
            <span className="break-words">{row.title}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

function observationOrdinal<T extends { id: string }>(
  rows: readonly T[],
  id: string,
  labelOf: (row: T) => string,
) {
  const row = rows.find((item) => item.id === id);
  if (!row) return "";
  const peers = rows.filter((item) => labelOf(item) === labelOf(row));
  return peers.length > 1
    ? `, observation ${peers.findIndex((item) => item.id === id) + 1} of ${peers.length}`
    : "";
}

function RankingPlot({
  row,
  max,
}: {
  row: { id: string; label: string; value: number };
  max: number;
}) {
  const { colors, theme } = useInstrumentChartTheme();
  const motion = useMotionAllowed();
  // Nivo owns each row's statistical scale; all rows in a ranking share one maximum.
  return (
    <div aria-hidden="true" className="w-[112px]">
      <Bar
        width={112}
        height={22}
        data={[row]}
        keys={["value"]}
        indexBy="id"
        layout="horizontal"
        valueScale={{ type: "linear", min: 0, max }}
        margin={{ top: 2, right: 5, bottom: 2, left: 5 }}
        padding={0.5}
        colors={[colors.accent]}
        theme={theme}
        animate={motion}
        axisLeft={null}
        axisBottom={null}
        enableGridY={false}
        enableGridX={false}
        isInteractive={false}
        layers={[
          ({ bars, innerWidth }) => (
            <g key="stems">
              {bars.map((bar) => (
                <g key={bar.key}>
                  <line
                    data-slot="ranking-reference"
                    x1={0}
                    x2={innerWidth}
                    y1={bar.y + bar.height / 2}
                    y2={bar.y + bar.height / 2}
                    stroke={colors.border}
                  />
                  <line
                    data-slot="ranking-value"
                    x1={0}
                    x2={bar.x + bar.width}
                    y1={bar.y + bar.height / 2}
                    y2={bar.y + bar.height / 2}
                    stroke={colors.accent}
                  />
                  <InstrumentChartPoint
                    x={bar.x + bar.width}
                    y={bar.y + bar.height / 2}
                    size={5}
                    color={colors.accent}
                  />
                </g>
              ))}
            </g>
          ),
        ]}
      />
    </div>
  );
}

function AlbumInspector({
  label,
  title,
  year,
  coverUrl,
  trackCount,
  duration,
  audio,
}: {
  label: string;
  title: string;
  year?: string | null;
  coverUrl?: string | null;
  trackCount?: number;
  duration?: number | null;
  audio?: AudioObservation;
}) {
  return (
    <div className="min-w-0 space-y-5">
      <div className="flex min-w-0 items-start gap-4">
        <MediaCover
          src={coverUrl}
          alt=""
          fallback={title.slice(0, 2)}
          className="size-16 shrink-0 sm:size-24"
        />
        <InstrumentChartReadout
          tone="accent"
          label={label}
          items={[
            { label: "Album", value: title, fullWidth: true },
            { label: "Year", value: year ?? "Unavailable" },
            { label: "Tracks", value: trackCount ?? "Unavailable" },
            { label: "Available duration", value: durationReading(duration) },
            ...(audio
              ? [
                  {
                    label: "BPM",
                    value: available(audio.avg_bpm)
                      ? audio.avg_bpm
                      : "Unavailable",
                  },
                  {
                    label: "Loudness estimate",
                    value: available(audio.avg_loudness)
                      ? `${audio.avg_loudness} dB`
                      : "Unavailable",
                  },
                ]
              : []),
          ]}
        />
      </div>
      {audio && (
        <div className="space-y-4">
          {(
            [
              ["Energy", audio.avg_energy],
              ["Danceability", audio.avg_danceability],
              ["Valence", audio.avg_valence],
              ["Acousticness", audio.avg_acousticness],
            ] as const
          ).map(([label, value]) => (
            <Meter
              key={label}
              label={label}
              value={value ?? null}
              max={1}
              valueText={available(value) ? value.toFixed(2) : ""}
            />
          ))}
        </div>
      )}
    </div>
  );
}
