import { useChartColors } from "@/hooks/use-chart-colors";
import { useMemo, type ReactNode } from "react";

import { ResponsiveBar } from "@nivo/bar";
import { ResponsiveScatterPlot } from "@nivo/scatterplot";

import {
  OpsPageHero,
  OpsPanel,
  OpsRefreshNotice,
  OpsStatTile,
  OpsSurface,
} from "@/components/admin/ops-surfaces";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { GridSkeleton } from "@/components/ui/grid-skeleton";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { useMotionAllowed } from "@crate/ui/lib/motion-gate";
import { useApi } from "@/hooks/use-api";
import { cn, formatNumber } from "@/lib/utils";

export interface InsightsData {
  countries: Record<string, number>;
  bpm_distribution: { bpm: string; count: number }[];
  energy_danceability: {
    x: number;
    y: number;
    artist: string;
    title: string;
  }[];
  top_genres: { genre: string; artists: number; albums: number }[];
  popularity: {
    artist: string;
    popularity: number;
    popularity_score?: number | null;
    listeners: number;
    albums: number;
  }[];
  albums_by_decade: Record<string, number>;
  top_albums: {
    album: string;
    artist: string;
    listeners: number;
    popularity: number;
    popularity_score?: number | null;
    year: string | null;
  }[];
  acoustic_instrumental: {
    x: number;
    y: number;
    artist: string;
    title: string;
  }[];
  feature_coverage: { feature: string; value: number; total: number }[];
  artist_depth: {
    artist: string;
    popularity: number;
    popularity_score?: number | null;
    listeners: number;
    albums: number;
    tracks: number;
  }[];
}

const NIVO_THEME = {
  text: { fill: "var(--text-muted)" },
  axis: {
    ticks: { text: { fill: "var(--text-subtle)", fontSize: 11 } },
    legend: { text: { fill: "var(--text-muted)", fontSize: 12 } },
  },
  grid: {
    line: {
      stroke: "color-mix(in srgb, var(--text-primary) 8%, transparent)",
      strokeWidth: 1,
    },
  },
  tooltip: {
    container: {
      background: "transparent",
      color: "var(--text-primary)",
      borderRadius: "0px",
      fontSize: 12,
      border: "none",
      boxShadow: "none",
      padding: 0,
      backdropFilter: "none",
    },
  },
  labels: { text: { fill: "var(--text-primary)", fontSize: 11 } },
  legends: { text: { fill: "var(--text-muted)", fontSize: 11 } },
};

function truncateLabel(value: string, max = 24) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function coveragePct(value: number, total: number) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center text-center text-sm text-text-subtle">
      {message}
    </div>
  );
}

type TooltipMetric = {
  label: string;
  value: string;
};

function ChartTooltip({
  eyebrow,
  title,
  subtitle,
  metrics,
  footer,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  metrics: TooltipMetric[];
  footer?: string;
}) {
  return (
    <div className="min-w-[220px] rounded-sm border border-border-quiet bg-card px-3 py-3 text-xs text-text-primary shadow-none">
      {eyebrow ? (
        <MonoLabel as="div" size="eyebrow" tone="accent" className="opacity-70">
          {eyebrow}
        </MonoLabel>
      ) : null}
      <div className={cn("space-y-0.5", eyebrow ? "mt-2" : "")}>
        <div className="font-medium leading-tight text-text-primary">
          {title}
        </div>
        {subtitle ? (
          <div className="text-[11px] text-text-muted">{subtitle}</div>
        ) : null}
      </div>
      <div className="mt-3 space-y-1.5">
        {metrics.map((metric) => (
          <div
            key={`${metric.label}-${metric.value}`}
            className="flex items-center justify-between gap-4 border-b border-border-quiet-subtle pb-1 last:border-b-0 last:pb-0"
          >
            <span className="text-text-muted">{metric.label}</span>
            <span className="font-medium text-text-primary">
              {metric.value}
            </span>
          </div>
        ))}
      </div>
      {footer ? (
        <div className="mt-3 border-t border-border-quiet-subtle pt-2 text-[10px] text-text-subtle">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

function InsightStoryCard({
  label,
  value,
  caption,
  accent = "primary",
}: {
  label: string;
  value: string;
  caption: string;
  accent?: "primary" | "muted";
}) {
  return (
    <OpsSurface
      className={cn(
        "p-4",
        accent === "primary"
          ? "border-accent-action/25"
          : "border-border-quiet",
      )}
    >
      <MonoLabel as="div" className="text-text-muted">
        {label}
      </MonoLabel>
      <div className="mt-2 font-display text-2xl font-semibold tracking-tight text-text-primary">
        {value}
      </div>
      <div className="mt-2 text-sm leading-relaxed text-text-muted">
        {caption}
      </div>
    </OpsSurface>
  );
}

function InsightChartCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <OpsSurface as="article" className={cn("overflow-hidden", className)}>
      <header className="border-b border-border-quiet px-4 pb-4 pt-4">
        <h3 className="font-display text-base font-semibold text-text-primary">
          {title}
        </h3>
        <p className="mt-1 text-sm text-text-muted">{description}</p>
      </header>
      <div className="p-4">{children}</div>
    </OpsSurface>
  );
}

export function Insights() {
  const motionAllowed = useMotionAllowed();
  const colors = useChartColors();
  const chartTheme = {
    ...NIVO_THEME,
    text: { fill: colors.secondary, fontFamily: "var(--font-mono-stack)" },
    axis: {
      ticks: { text: { fill: colors.subtle, fontSize: 11 } },
      legend: { text: { fill: colors.secondary, fontSize: 12 } },
    },
    grid: { line: { stroke: colors.border, strokeWidth: 1 } },
    labels: { text: { fill: colors.primary, fontSize: 11 } },
    legends: { text: { fill: colors.secondary, fontSize: 11 } },
  };
  const { data, loading, error, refetch } =
    useApi<InsightsData>("/api/insights");

  const decadeData = useMemo(() => {
    if (!data?.albums_by_decade) return [];
    return Object.entries(data.albums_by_decade)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([decade, count]) => ({ decade, albums: count }));
  }, [data?.albums_by_decade]);

  const genreData = useMemo(() => {
    return (data?.top_genres ?? []).slice(0, 12).map((genre) => ({
      genre: genre.genre,
      artists: genre.artists,
      albums: genre.albums,
      fullGenre: genre.genre,
    }));
  }, [data?.top_genres]);

  const countryData = useMemo(() => {
    if (!data?.countries) return [];
    return Object.entries(data.countries)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 12)
      .map(([country, count]) => ({
        country: country,
        artists: count,
        fullCountry: country,
      }));
  }, [data?.countries]);

  const popularityData = useMemo(() => {
    return (data?.popularity ?? []).slice(0, 12).map((item, index) => ({
      artist: JSON.stringify([item.artist, index]),
      fullArtist: item.artist,
      popularity:
        item.popularity_score != null
          ? Math.round(item.popularity_score * 100)
          : item.popularity,
      listeners: item.listeners,
      albums: item.albums,
    }));
  }, [data?.popularity]);

  const topAlbumData = useMemo(() => {
    return (data?.top_albums ?? []).slice(0, 12).map((album, index) => ({
      album: JSON.stringify([album.artist, album.album, album.year, index]),
      fullAlbum: album.album,
      fullArtist: album.artist,
      popularity:
        album.popularity_score != null
          ? Math.round(album.popularity_score * 100)
          : album.popularity,
      listeners: album.listeners,
      year: album.year ?? "",
    }));
  }, [data?.top_albums]);

  const featureCoverageData = useMemo(() => {
    return (data?.feature_coverage ?? []).map((feature) => ({
      feature: feature.feature,
      coverage: coveragePct(feature.value, feature.total),
      total: feature.total,
      value: feature.value,
    }));
  }, [data?.feature_coverage]);

  const artistDepthSeries = useMemo(() => {
    return [
      {
        id: "artists",
        data: (data?.artist_depth ?? []).map((artist) => ({
          x:
            artist.popularity_score != null
              ? Math.round(artist.popularity_score * 100)
              : artist.popularity,
          y: artist.albums,
          artist: artist.artist,
          tracks: artist.tracks,
          listeners: artist.listeners,
          albums: artist.albums,
        })),
      },
    ];
  }, [data?.artist_depth]);

  const avgFeatureCoverage = useMemo(() => {
    if (!featureCoverageData.length) return 0;
    return Math.round(
      featureCoverageData.reduce((sum, item) => sum + item.coverage, 0) /
        featureCoverageData.length,
    );
  }, [featureCoverageData]);

  const countriesRepresented = Object.keys(data?.countries ?? {}).length;
  const decadesRepresented = Object.keys(data?.albums_by_decade ?? {}).length;
  const surfacedStandouts =
    (data?.popularity.length ?? 0) + (data?.top_albums.length ?? 0);
  const leadGenre = data?.top_genres[0];
  const leadFeature = [...featureCoverageData].sort(
    (a, b) => b.coverage - a.coverage,
  )[0];
  const leadDecade = [...decadeData].sort((a, b) => b.albums - a.albums)[0];

  if (loading) {
    return (
      <div className="space-y-6">
        <OpsPageHero
          title="Insights"
          description="Macro patterns across the library, with a cleaner split between collection shape, standouts and audio signature."
        >
          <InfoBadge>Collection shape</InfoBadge>
          <InfoBadge>Standouts</InfoBadge>
          <InfoBadge>Audio signature</InfoBadge>
        </OpsPageHero>
        <GridSkeleton count={6} columns="grid-cols-1 xl:grid-cols-2" />
      </div>
    );
  }

  if (error && !data) {
    return <ErrorState message="Failed to load insights" onRetry={refetch} />;
  }

  if (!data) {
    return (
      <ErrorState message="No insight data available yet" onRetry={refetch} />
    );
  }

  return (
    <div className="space-y-6">
      <OpsPageHero
        title="Insights"
        description="A macro read on how the library is shaped, where its weight sits, and how much of the collection is analytically mapped."
      >
        <InfoBadge>Collection shape</InfoBadge>
        <InfoBadge>Standouts</InfoBadge>
        <InfoBadge>Audio signature</InfoBadge>
      </OpsPageHero>

      {error ? (
        <OpsRefreshNotice
          message="Insights could not refresh. Showing the last successful snapshot."
          onRetry={refetch}
        />
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OpsStatTile
          label="Countries"
          value={formatNumber(countriesRepresented)}
          caption="Artist origins represented in the library"
          tone="primary"
        />
        <OpsStatTile
          label="Decades"
          value={formatNumber(decadesRepresented)}
          caption="Release decades with real catalog density"
          tone="default"
        />
        <OpsStatTile
          label="Feature Coverage"
          value={`${avgFeatureCoverage}%`}
          caption={`${featureCoverageData.length} analysis signals tracked across the catalog`}
          tone={avgFeatureCoverage >= 70 ? "success" : "warning"}
        />
        <OpsStatTile
          label="Standouts Surfaced"
          value={formatNumber(surfacedStandouts)}
          caption={`${formatNumber(
            data.popularity.length,
          )} artists and ${formatNumber(
            data.top_albums.length,
          )} albums with strong signal`}
          tone="default"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <InsightStoryCard
          label="Most Represented Genre"
          value={leadGenre?.genre ?? "No genre signal yet"}
          caption={
            leadGenre
              ? `${formatNumber(leadGenre.artists)} artists and ${formatNumber(
                  leadGenre.albums,
                )} albums currently shape the strongest taxonomy cluster.`
              : "As genre enrichment lands, this slot will summarize the library's strongest cultural cluster."
          }
          accent="primary"
        />
        <InsightStoryCard
          label="Collection Center of Gravity"
          value={leadDecade?.decade ?? "No decade signal yet"}
          caption={
            leadDecade
              ? `${formatNumber(
                  leadDecade.albums,
                )} albums make this the decade where the catalog feels heaviest.`
              : "This will surface the decade where release density really accumulates."
          }
        />
        <InsightStoryCard
          label="Best-Mapped Feature"
          value={
            leadFeature
              ? `${leadFeature.feature} ${leadFeature.coverage}%`
              : "No feature signal yet"
          }
          caption={
            leadFeature
              ? `${formatNumber(leadFeature.value)} of ${formatNumber(
                  leadFeature.total,
                )} tracks already carry this analytical signal.`
              : "Feature coverage becomes more informative as analysis jobs fill in the catalog."
          }
        />
      </div>

      <OpsPanel
        title="Collection Shape"
        description="The broad cultural and catalog footprint of the library: genres, countries and decades."
      >
        <div className="grid gap-4 xl:grid-cols-3">
          <InsightChartCard
            title="Genre Footprint"
            description={`Top ${formatNumber(
              genreData.length,
            )} genres by artist and album depth.`}
          >
            <div className="h-[320px]">
              {genreData.length > 0 ? (
                <ResponsiveBar
                  data={genreData}
                  keys={["artists", "albums"]}
                  indexBy="genre"
                  layout="horizontal"
                  margin={{ top: 8, right: 24, bottom: 36, left: 136 }}
                  padding={0.24}
                  groupMode="grouped"
                  colors={[colors.accent, colors.secondary]}
                  borderRadius={4}
                  labelSkipWidth={16}
                  labelSkipHeight={16}
                  axisBottom={{ tickSize: 0, tickPadding: 8 }}
                  axisLeft={{
                    tickSize: 0,
                    tickPadding: 8,
                    format: (value) => truncateLabel(String(value), 16),
                  }}
                  legends={[
                    {
                      dataFrom: "keys",
                      anchor: "bottom-right",
                      direction: "row",
                      translateY: 34,
                      itemWidth: 80,
                      itemHeight: 16,
                      symbolSize: 10,
                    },
                  ]}
                  theme={chartTheme}
                  motionConfig="gentle"
                  animate={motionAllowed}
                  tooltip={({ id, value, data: datum }) => (
                    <ChartTooltip
                      eyebrow="Genre footprint"
                      title={String(
                        (datum as { fullGenre?: string }).fullGenre ?? "",
                      )}
                      metrics={[
                        {
                          label: String(id),
                          value: formatNumber(Number(value)),
                        },
                        {
                          label:
                            String(id) === "artists" ? "Albums" : "Artists",
                          value: formatNumber(
                            Number(
                              String(id) === "artists"
                                ? (datum as { albums: number }).albums
                                : (datum as { artists: number }).artists,
                            ),
                          ),
                        },
                      ]}
                      footer="Grouped bars show how broad each genre is across artists versus albums."
                    />
                  )}
                />
              ) : (
                <ChartEmpty message="No genre distribution available yet." />
              )}
            </div>
          </InsightChartCard>

          <InsightChartCard
            title="Artists by Country"
            description="Where the library is geographically anchored."
          >
            <div className="h-[320px]">
              {countryData.length > 0 ? (
                <ResponsiveBar
                  data={countryData}
                  keys={["artists"]}
                  indexBy="country"
                  layout="horizontal"
                  margin={{ top: 8, right: 24, bottom: 16, left: 122 }}
                  padding={0.26}
                  colors={[colors.accent]}
                  borderRadius={4}
                  enableLabel={false}
                  axisBottom={{ tickSize: 0, tickPadding: 8 }}
                  axisLeft={{
                    tickSize: 0,
                    tickPadding: 8,
                    format: (value) => truncateLabel(String(value), 14),
                  }}
                  theme={chartTheme}
                  motionConfig="gentle"
                  animate={motionAllowed}
                  tooltip={({ value, data: datum }) => (
                    <ChartTooltip
                      eyebrow="Artist origins"
                      title={String(
                        (datum as { fullCountry?: string }).fullCountry ?? "",
                      )}
                      metrics={[
                        {
                          label: "Artists",
                          value: formatNumber(Number(value)),
                        },
                      ]}
                      footer="Country coverage depends on artist enrichment, so this chart grows as metadata improves."
                    />
                  )}
                />
              ) : (
                <ChartEmpty message="Country data appears once artists have been enriched." />
              )}
            </div>
          </InsightChartCard>

          <InsightChartCard
            title="Albums by Decade"
            description="Where the collection is densest across release eras."
          >
            <div className="h-[320px]">
              {decadeData.length > 0 ? (
                <ResponsiveBar
                  data={decadeData}
                  keys={["albums"]}
                  indexBy="decade"
                  margin={{ top: 8, right: 16, bottom: 34, left: 48 }}
                  padding={0.28}
                  colors={[colors.accent]}
                  borderRadius={4}
                  enableLabel={false}
                  axisBottom={{ tickRotation: 0, tickSize: 0, tickPadding: 8 }}
                  axisLeft={{ tickSize: 0, tickPadding: 8 }}
                  theme={chartTheme}
                  motionConfig="gentle"
                  animate={motionAllowed}
                  tooltip={({ value, data: datum }) => (
                    <ChartTooltip
                      eyebrow="Catalog density"
                      title={String(
                        (datum as { decade?: string }).decade ?? "",
                      )}
                      metrics={[
                        { label: "Albums", value: formatNumber(Number(value)) },
                      ]}
                      footer="This shows the decade where your release density really concentrates."
                    />
                  )}
                />
              ) : (
                <ChartEmpty message="Release years need to be present to build decade coverage." />
              )}
            </div>
          </InsightChartCard>
        </div>
      </OpsPanel>

      <OpsPanel
        title="Standouts"
        description="Popularity and catalog depth, using the consolidated scoring model instead of the older Spotify-heavy heuristic."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <InsightChartCard
            title="Artist Momentum"
            description="Artists with the strongest combined popularity signal."
          >
            <div className="h-[340px]">
              {popularityData.length > 0 ? (
                <ResponsiveBar
                  data={popularityData}
                  keys={["popularity"]}
                  indexBy="artist"
                  layout="horizontal"
                  margin={{ top: 8, right: 22, bottom: 16, left: 156 }}
                  padding={0.24}
                  colors={[colors.accent]}
                  borderRadius={4}
                  enableLabel={false}
                  valueScale={{ type: "linear", min: 0, max: 100 }}
                  axisBottom={{ tickSize: 0, tickPadding: 8 }}
                  axisLeft={{
                    tickSize: 0,
                    tickPadding: 8,
                    format: (value) =>
                      truncateLabel(
                        popularityData.find(
                          (row) => row.artist === String(value),
                        )?.fullArtist ?? String(value),
                        20,
                      ),
                  }}
                  theme={chartTheme}
                  motionConfig="gentle"
                  animate={motionAllowed}
                  tooltip={({ value, data: datum }) => (
                    <ChartTooltip
                      eyebrow="Artist standout"
                      title={String(
                        (datum as { fullArtist?: string }).fullArtist ?? "",
                      )}
                      metrics={[
                        {
                          label: "Popularity score",
                          value: formatNumber(Number(value)),
                        },
                        {
                          label: "Listeners",
                          value: formatNumber(
                            Number((datum as { listeners: number }).listeners),
                          ),
                        },
                        {
                          label: "Albums in library",
                          value: formatNumber(
                            Number((datum as { albums: number }).albums),
                          ),
                        },
                      ]}
                      footer="Artist momentum now comes from the consolidated popularity model, not the older Spotify-heavy heuristic."
                    />
                  )}
                />
              ) : (
                <ChartEmpty message="Popularity scoring will appear here once artist signals are available." />
              )}
            </div>
          </InsightChartCard>

          <InsightChartCard
            title="Album Standouts"
            description="The strongest individual album signals across the catalog."
          >
            <div className="h-[340px]">
              {topAlbumData.length > 0 ? (
                <ResponsiveBar
                  data={topAlbumData}
                  keys={["popularity"]}
                  indexBy="album"
                  layout="horizontal"
                  margin={{ top: 8, right: 22, bottom: 16, left: 164 }}
                  padding={0.24}
                  colors={[colors.secondary]}
                  borderRadius={4}
                  enableLabel={false}
                  valueScale={{ type: "linear", min: 0, max: 100 }}
                  axisBottom={{ tickSize: 0, tickPadding: 8 }}
                  axisLeft={{
                    tickSize: 0,
                    tickPadding: 8,
                    format: (value) =>
                      truncateLabel(
                        topAlbumData.find((row) => row.album === String(value))
                          ?.fullAlbum ?? String(value),
                        22,
                      ),
                  }}
                  theme={chartTheme}
                  motionConfig="gentle"
                  animate={motionAllowed}
                  tooltip={({ value, data: datum }) => (
                    <ChartTooltip
                      eyebrow="Album standout"
                      title={String(
                        (datum as { fullAlbum?: string }).fullAlbum ?? "",
                      )}
                      subtitle={String(
                        (datum as { fullArtist?: string }).fullArtist ?? "",
                      )}
                      metrics={[
                        {
                          label: "Popularity score",
                          value: formatNumber(Number(value)),
                        },
                        {
                          label: "Listeners",
                          value: formatNumber(
                            Number((datum as { listeners: number }).listeners),
                          ),
                        },
                        {
                          label: "Year",
                          value:
                            (datum as { year?: string | null }).year ||
                            "Unknown",
                        },
                      ]}
                      footer="Albums surface here by consolidated score first, with listeners as supporting signal."
                    />
                  )}
                />
              ) : (
                <ChartEmpty message="Album standouts appear once album-level popularity has been computed." />
              )}
            </div>
          </InsightChartCard>

          <InsightChartCard
            title="Artist Depth vs Popularity"
            description="Who is both widely weighted and deeply represented in the collection."
            className="xl:col-span-2"
          >
            <div className="h-[360px]">
              {artistDepthSeries[0]?.data.length ? (
                <ResponsiveScatterPlot
                  data={artistDepthSeries}
                  xScale={{ type: "linear", min: 0, max: 100 }}
                  yScale={{ type: "linear", min: 0, max: "auto" }}
                  margin={{ top: 10, right: 20, bottom: 48, left: 56 }}
                  axisBottom={{
                    legend: "Popularity score",
                    legendPosition: "middle",
                    legendOffset: 36,
                    tickSize: 0,
                    tickPadding: 8,
                  }}
                  axisLeft={{
                    legend: "Albums in library",
                    legendPosition: "middle",
                    legendOffset: -42,
                    tickSize: 0,
                    tickPadding: 8,
                  }}
                  nodeSize={8}
                  colors={[colors.accent]}
                  useMesh={true}
                  theme={chartTheme}
                  motionConfig="gentle"
                  animate={motionAllowed}
                  tooltip={({ node }) => {
                    const point = node.data as {
                      artist: string;
                      tracks: number;
                      listeners: number;
                      albums: number;
                      x: number;
                    };
                    return (
                      <ChartTooltip
                        eyebrow="Depth vs popularity"
                        title={point.artist}
                        metrics={[
                          {
                            label: "Popularity score",
                            value: formatNumber(Number(point.x)),
                          },
                          {
                            label: "Albums",
                            value: formatNumber(point.albums),
                          },
                          {
                            label: "Tracks",
                            value: formatNumber(point.tracks),
                          },
                          {
                            label: "Listeners",
                            value: formatNumber(point.listeners),
                          },
                        ]}
                        footer="The upper-right corner is where both library depth and external signal concentrate."
                      />
                    );
                  }}
                />
              ) : (
                <ChartEmpty message="Artist depth needs album and popularity scoring to line up before it becomes useful." />
              )}
            </div>
          </InsightChartCard>
        </div>
      </OpsPanel>

      <OpsPanel
        title="Audio Signature"
        description="How much of the library is analytically described, and what that description says about its sonic shape."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <InsightChartCard
            title="Feature Coverage"
            description="Coverage by analysis dimension, not just overall completeness."
          >
            <div className="h-[320px]">
              {featureCoverageData.length > 0 ? (
                <ResponsiveBar
                  data={featureCoverageData}
                  keys={["coverage"]}
                  indexBy="feature"
                  layout="horizontal"
                  margin={{ top: 8, right: 24, bottom: 16, left: 132 }}
                  padding={0.26}
                  colors={[colors.accent]}
                  borderRadius={4}
                  enableLabel={true}
                  labelTextColor={colors.primary}
                  valueScale={{ type: "linear", min: 0, max: 100 }}
                  axisBottom={{ tickSize: 0, tickPadding: 8 }}
                  axisLeft={{ tickSize: 0, tickPadding: 8 }}
                  theme={chartTheme}
                  motionConfig="gentle"
                  animate={motionAllowed}
                  tooltip={({ value, data: datum }) => (
                    <ChartTooltip
                      eyebrow="Analysis coverage"
                      title={String(
                        (datum as { feature?: string }).feature ?? "",
                      )}
                      metrics={[
                        {
                          label: "Coverage",
                          value: `${formatNumber(Number(value))}%`,
                        },
                        {
                          label: "Tracks with signal",
                          value: `${formatNumber(
                            Number((datum as { value: number }).value),
                          )} / ${formatNumber(
                            Number((datum as { total: number }).total),
                          )}`,
                        },
                      ]}
                      footer="This turns analysis completeness into per-feature visibility instead of a single blended number."
                    />
                  )}
                />
              ) : (
                <ChartEmpty message="Feature coverage appears once analysis jobs have populated the catalog." />
              )}
            </div>
          </InsightChartCard>

          <InsightChartCard
            title="BPM Distribution"
            description="The tempo profile of the analyzed part of the library."
          >
            <div className="h-[320px]">
              {data.bpm_distribution.length > 0 ? (
                <ResponsiveBar
                  data={data.bpm_distribution}
                  keys={["count"]}
                  indexBy="bpm"
                  margin={{ top: 8, right: 16, bottom: 38, left: 48 }}
                  padding={0.22}
                  colors={[colors.accent]}
                  borderRadius={4}
                  enableLabel={false}
                  axisBottom={{ tickRotation: 0, tickSize: 0, tickPadding: 8 }}
                  axisLeft={{ tickSize: 0, tickPadding: 8 }}
                  theme={chartTheme}
                  motionConfig="gentle"
                  animate={motionAllowed}
                  tooltip={({ value, data: datum }) => (
                    <ChartTooltip
                      eyebrow="Tempo bucket"
                      title={String((datum as { bpm?: string }).bpm ?? "")}
                      metrics={[
                        { label: "Tracks", value: formatNumber(Number(value)) },
                      ]}
                      footer="BPM buckets give a fast read on whether the analyzed library clusters in slower, mid-tempo or high-energy bands."
                    />
                  )}
                />
              ) : (
                <ChartEmpty message="Run audio analysis to expose tempo distribution." />
              )}
            </div>
          </InsightChartCard>

          <InsightChartCard
            title="Energy vs Danceability"
            description="A fast read on how forceful versus body-moving the library tends to be."
          >
            <div className="h-[340px]">
              {data.energy_danceability.length > 0 ? (
                <ResponsiveScatterPlot
                  data={[{ id: "tracks", data: data.energy_danceability }]}
                  xScale={{ type: "linear", min: 0, max: 1 }}
                  yScale={{ type: "linear", min: 0, max: 1 }}
                  margin={{ top: 10, right: 16, bottom: 48, left: 54 }}
                  axisBottom={{
                    legend: "Energy",
                    legendPosition: "middle",
                    legendOffset: 36,
                    tickSize: 0,
                    tickPadding: 8,
                  }}
                  axisLeft={{
                    legend: "Danceability",
                    legendPosition: "middle",
                    legendOffset: -40,
                    tickSize: 0,
                    tickPadding: 8,
                  }}
                  nodeSize={6}
                  colors={[colors.accent]}
                  useMesh={true}
                  theme={chartTheme}
                  motionConfig="gentle"
                  animate={motionAllowed}
                  tooltip={({ node }) => {
                    const point = node.data as {
                      title?: string;
                      artist?: string;
                    };
                    return (
                      <ChartTooltip
                        eyebrow="Audio profile"
                        title={String(point.title ?? "Track")}
                        subtitle={String(point.artist ?? "Unknown artist")}
                        metrics={[
                          {
                            label: "Energy",
                            value: formatNumber(
                              Number((node.data as { x?: number }).x ?? 0),
                            ),
                          },
                          {
                            label: "Danceability",
                            value: formatNumber(
                              Number((node.data as { y?: number }).y ?? 0),
                            ),
                          },
                        ]}
                        footer="This overlay uses the same structure as the rest of Insights, so audio scatters no longer fall back to a legacy tooltip."
                      />
                    );
                  }}
                />
              ) : (
                <ChartEmpty message="This scatter appears once tracks have audio features." />
              )}
            </div>
          </InsightChartCard>

          <InsightChartCard
            title="Acousticness vs Instrumentalness"
            description="The balance between organic texture and vocal/instrumental bias."
          >
            <div className="h-[340px]">
              {data.acoustic_instrumental.length > 0 ? (
                <ResponsiveScatterPlot
                  data={[{ id: "tracks", data: data.acoustic_instrumental }]}
                  xScale={{ type: "linear", min: 0, max: 1 }}
                  yScale={{ type: "linear", min: 0, max: 1 }}
                  margin={{ top: 10, right: 16, bottom: 48, left: 54 }}
                  axisBottom={{
                    legend: "Acousticness",
                    legendPosition: "middle",
                    legendOffset: 36,
                    tickSize: 0,
                    tickPadding: 8,
                  }}
                  axisLeft={{
                    legend: "Instrumentalness",
                    legendPosition: "middle",
                    legendOffset: -40,
                    tickSize: 0,
                    tickPadding: 8,
                  }}
                  nodeSize={6}
                  colors={[colors.secondary]}
                  useMesh={true}
                  theme={chartTheme}
                  motionConfig="gentle"
                  animate={motionAllowed}
                  tooltip={({ node }) => {
                    const point = node.data as {
                      title?: string;
                      artist?: string;
                    };
                    return (
                      <ChartTooltip
                        eyebrow="Audio profile"
                        title={String(point.title ?? "Track")}
                        subtitle={String(point.artist ?? "Unknown artist")}
                        metrics={[
                          {
                            label: "Acousticness",
                            value: formatNumber(
                              Number((node.data as { x?: number }).x ?? 0),
                            ),
                          },
                          {
                            label: "Instrumentalness",
                            value: formatNumber(
                              Number((node.data as { y?: number }).y ?? 0),
                            ),
                          },
                        ]}
                        footer="This makes it much easier to distinguish organic, vocal and instrumental outliers without losing context."
                      />
                    );
                  }}
                />
              ) : (
                <ChartEmpty message="This view fills in once acoustic and instrumental signals are present." />
              )}
            </div>
          </InsightChartCard>
        </div>
      </OpsPanel>
    </div>
  );
}
