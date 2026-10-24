import { useApi } from "@/hooks/use-api";
import { useChartColors } from "@/hooks/use-chart-colors";
import { useMotionAllowed } from "@crate/ui/lib/motion-gate";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { artistActionApiPath } from "@/lib/library-routes";
import { ResponsivePie } from "@nivo/pie";
import { ResponsiveBar } from "@nivo/bar";
import { ResponsiveRadar, svgDefaultProps } from "@nivo/radar";

interface ArtistStatsData {
  formats: { id: string; value: number }[];
  albums_timeline: {
    name: string;
    year: string;
    track_count: number;
    popularity: number | null;
    lastfm_listeners: number | null;
  }[];
  audio_by_album: {
    album: string;
    avg_bpm: number | null;
    avg_energy: number | null;
    avg_danceability: number | null;
    avg_valence: number | null;
    avg_acousticness: number | null;
  }[];
  top_tracks_by_popularity: {
    title: string;
    album: string;
    popularity: number;
    lastfm_listeners: number;
  }[];
  genres: { name: string; weight: number }[];
}

export function ArtistStats({
  artistId,
  artistEntityUid,
}: {
  artistId?: number;
  artistEntityUid?: string;
}) {
  const colors = useChartColors();
  const motionAllowed = useMotionAllowed();
  const theme = {
    text: {
      fill: colors.secondary,
      fontFamily: "var(--font-mono-stack)",
      fontSize: 11,
    },
    axis: { ticks: { text: { fill: colors.subtle, fontSize: 11 } } },
    grid: { line: { stroke: colors.border } },
    tooltip: {
      container: {
        background: colors.surface,
        color: colors.primary,
        borderRadius: "6px",
        fontSize: 12,
        border: `1px solid ${colors.border}`,
        boxShadow: "none",
      },
    },
    labels: { text: { fill: colors.primary, fontSize: 11 } },
    legends: { text: { fill: colors.secondary, fontSize: 11 } },
  };
  const palette = [colors.accent, colors.secondary, colors.subtle];
  const { data, loading, error, refetch } = useApi<ArtistStatsData>(
    artistActionApiPath({ artistId, artistEntityUid }, "stats") || null,
  );

  if (loading) return <LoadingState label="Loading stats" />;
  if (error)
    return (
      <ErrorState
        message="Artist statistics could not be loaded."
        onRetry={refetch}
      />
    );
  if (!data)
    return <p className="py-8 text-sm text-text-muted">No stats available</p>;

  const radarData =
    data.audio_by_album.length > 0
      ? data.audio_by_album.map((a) => ({
          album: a.album,
          energy: a.avg_energy ?? 0,
          danceability: a.avg_danceability ?? 0,
          valence: a.avg_valence ?? 0,
          acousticness: a.avg_acousticness ?? 0,
        }))
      : [];
  const timelineData = data.albums_timeline.reduce<
    Array<{ album: string; label: string; tracks: number; year: string }>
  >((items, album, index) => {
    if (!album.year) return items;
    items.push({
      album: JSON.stringify([album.name, album.year, index]),
      label: album.name,
      tracks: album.track_count,
      year: album.year,
    });
    return items;
  }, []);

  return (
    <div className="space-y-6">
      {data.albums_timeline.length > 0 && (
        <InstrumentPanel
          as="section"
          headingLevel={3}
          ruled={false}
          label={{ children: "Discography Timeline", tone: "accent" }}
        >
          <div className="h-[200px]">
            <ResponsiveBar
              data={timelineData}
              keys={["tracks"]}
              indexBy="album"
              margin={{ top: 10, right: 10, bottom: 50, left: 40 }}
              padding={0.3}
              colors={[colors.accent]}
              borderRadius={3}
              enableLabel={true}
              labelTextColor={colors.primary}
              axisBottom={{
                tickRotation: -35,
                format: (value) => {
                  const name =
                    timelineData.find((row) => row.album === String(value))
                      ?.label ?? String(value);
                  return name.length > 18 ? `${name.slice(0, 18)}…` : name;
                },
              }}
              theme={theme}
              animate={motionAllowed}
              motionConfig="gentle"
              tooltip={({ data: d }) => (
                <div
                  style={{
                    background: colors.surface,
                    color: colors.primary,
                    padding: "6px 10px",
                    borderRadius: "6px",
                    fontSize: 11,
                    border: `1px solid ${colors.border}`,
                  }}
                >
                  <strong>{String(d.label)}</strong> ({String(d.year)})<br />
                  {String(d.tracks)} tracks
                </div>
              )}
            />
          </div>
        </InstrumentPanel>
      )}
      {data.formats.length > 0 || data.genres.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.formats.length > 0 && (
            <InstrumentPanel
              as="section"
              headingLevel={3}
              ruled={data.albums_timeline.length > 0}
              label={{ children: "Formats", tone: "accent" }}
            >
              <div className="h-[180px]">
                <ResponsivePie
                  data={data.formats}
                  margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
                  innerRadius={0.6}
                  padAngle={2}
                  cornerRadius={4}
                  colors={palette}
                  borderWidth={0}
                  enableArcLinkLabels={true}
                  arcLinkLabelsColor={{ from: "color" }}
                  arcLinkLabelsTextColor={colors.secondary}
                  arcLinkLabelsThickness={2}
                  arcLabelsTextColor={colors.primary}
                  theme={theme}
                  animate={motionAllowed}
                />
              </div>
            </InstrumentPanel>
          )}
          {data.genres.length > 0 && (
            <InstrumentPanel
              as="section"
              headingLevel={3}
              ruled={data.albums_timeline.length > 0}
              label={{ children: "Genre Profile", tone: "accent" }}
            >
              <div className="h-[180px]">
                <ResponsiveBar
                  data={data.genres.map((g) => ({
                    genre: g.name,
                    weight: Math.round(g.weight * 100),
                  }))}
                  keys={["weight"]}
                  indexBy="genre"
                  axisLeft={{
                    format: (value) =>
                      String(value).length > 14
                        ? `${String(value).slice(0, 14)}…`
                        : String(value),
                  }}
                  layout="horizontal"
                  margin={{ top: 5, right: 20, bottom: 5, left: 100 }}
                  padding={0.3}
                  colors={[colors.accent]}
                  borderRadius={3}
                  enableLabel={true}
                  labelTextColor={colors.primary}
                  theme={theme}
                  animate={motionAllowed}
                  motionConfig="gentle"
                />
              </div>
            </InstrumentPanel>
          )}
        </div>
      ) : null}

      {data.top_tracks_by_popularity.length > 0 && (
        <InstrumentPanel
          as="section"
          headingLevel={3}
          ruled={
            data.albums_timeline.length > 0 ||
            data.formats.length > 0 ||
            data.genres.length > 0
          }
          label={{ children: "Most Popular Tracks", tone: "accent" }}
        >
          <div className="h-[250px]">
            <ResponsiveBar
              data={data.top_tracks_by_popularity
                .slice(0, 10)
                .reverse()
                .map((t, index) => ({
                  track: JSON.stringify([t.title, t.album, index]),
                  title: t.title,
                  album: t.album,
                  listeners: t.lastfm_listeners || t.popularity,
                }))}
              keys={["listeners"]}
              indexBy="track"
              axisLeft={{
                format: (value) => {
                  const title = JSON.parse(String(value))[0] as string;
                  return title.length > 20 ? `${title.slice(0, 20)}…` : title;
                },
              }}
              tooltip={({ data: d, value }) => (
                <div className="bg-card p-3 text-sm text-text-primary">
                  {String(d.title)} · {String(d.album)}: {value}
                </div>
              )}
              layout="horizontal"
              margin={{ top: 5, right: 20, bottom: 5, left: 160 }}
              padding={0.3}
              colors={[colors.accent]}
              borderRadius={3}
              enableLabel={true}
              labelTextColor={colors.primary}
              theme={theme}
              animate={motionAllowed}
              motionConfig="gentle"
            />
          </div>
        </InstrumentPanel>
      )}

      {radarData.length > 0 && (
        <InstrumentPanel
          as="section"
          headingLevel={3}
          ruled={
            data.albums_timeline.length > 0 ||
            data.formats.length > 0 ||
            data.genres.length > 0 ||
            data.top_tracks_by_popularity.length > 0
          }
          label={{ children: "Audio Profile by Album", tone: "accent" }}
        >
          <div className="h-[300px]">
            <ResponsiveRadar
              data={radarData}
              keys={["energy", "danceability", "valence", "acousticness"]}
              indexBy="album"
              maxValue={1}
              margin={{ top: 30, right: 60, bottom: 30, left: 60 }}
              curve="linearClosed"
              gridLabelOffset={16}
              gridLabel={(props) => {
                const Label = svgDefaultProps.gridLabel;
                return (
                  <Label
                    {...props}
                    id={
                      props.id.length > 15
                        ? `${props.id.slice(0, 15)}…`
                        : props.id
                    }
                  />
                );
              }}
              dotSize={8}
              dotColor={{ theme: "background" }}
              dotBorderWidth={2}
              colors={palette}
              fillOpacity={0.2}
              theme={{
                ...theme,
                labels: { text: { fill: colors.secondary, fontSize: 11 } },
              }}
              animate={motionAllowed}
              motionConfig="gentle"
              legends={[
                {
                  anchor: "top-left",
                  direction: "column",
                  itemWidth: 80,
                  itemHeight: 20,
                  symbolSize: 10,
                  symbolShape: "circle",
                },
              ]}
            />
          </div>
        </InstrumentPanel>
      )}
      {(() => {
        const albumPop = data.albums_timeline
          .filter(
            (a) => (a.lastfm_listeners ?? 0) > 0 || (a.popularity ?? 0) > 0,
          )
          .sort(
            (a, b) =>
              (b.lastfm_listeners ?? b.popularity ?? 0) -
              (a.lastfm_listeners ?? a.popularity ?? 0),
          )
          .slice(0, 8);
        if (!albumPop.length) return null;
        return (
          <InstrumentPanel
            as="section"
            headingLevel={3}
            label={{ children: "Top Albums", tone: "accent" }}
          >
            <div className="h-[200px]">
              <ResponsiveBar
                data={albumPop.reverse().map((a, index) => ({
                  album: JSON.stringify([a.name, a.year, index]),
                  label: a.name,
                  listeners: a.lastfm_listeners ?? a.popularity ?? 0,
                }))}
                keys={["listeners"]}
                indexBy="album"
                axisLeft={{
                  format: (value) => {
                    const title = JSON.parse(String(value))[0] as string;
                    return title.length > 20 ? `${title.slice(0, 20)}…` : title;
                  },
                }}
                tooltip={({ data: d, value }) => (
                  <div className="bg-card p-3 text-sm text-text-primary">
                    {String(d.label)}: {value}
                  </div>
                )}
                layout="horizontal"
                margin={{ top: 5, right: 20, bottom: 5, left: 160 }}
                padding={0.3}
                colors={[colors.accent]}
                borderRadius={3}
                enableLabel={true}
                labelTextColor={colors.primary}
                theme={theme}
                animate={motionAllowed}
                motionConfig="gentle"
              />
            </div>
          </InstrumentPanel>
        );
      })()}
    </div>
  );
}
