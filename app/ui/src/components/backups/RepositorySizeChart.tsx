import { useMemo } from "react";
import { ResponsiveLine, type LineCustomSvgLayerProps } from "@nivo/line";

import { readCssColorToken } from "@crate/ui/lib/read-css-color";

import {
  InstrumentChartLegend,
  useInstrumentChartTheme,
} from "@/components/charts/InstrumentChart";
import { formatDay, type BackupOverview } from "@/lib/backups";

const DAY_MS = 86_400_000;
const GB = 1024 ** 3;

interface SeriesStyle {
  color: string;
  dashed?: boolean;
}

interface SizeSeries {
  id: string;
  destinationId: string;
  data: { x: number; y: number }[];
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const step = steps.find((s) => value / s <= 4) ?? Math.ceil(value / 4);
  return Math.ceil(value / step) * step;
}

/**
 * Repository size per destination over the last 90 days (Nivo, BK5). The
 * points are the size after the last good copy of each day. A failing
 * destination is drawn in the danger tone; the local volume is dashed.
 */
export function RepositorySizeChart({
  overview,
  now = Date.now(),
}: {
  overview: Pick<BackupOverview, "size_series" | "destinations">;
  now?: number;
}) {
  const { colors, theme } = useInstrumentChartTheme();
  const danger = useMemo(
    () =>
      (typeof document !== "undefined" &&
        readCssColorToken(document.documentElement, "--state-danger")) ||
      "var(--state-danger)",
    [],
  );
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const destinations = new Map(overview.destinations.map((d) => [d.id, d]));
  const palette = [
    colors.accent,
    colors.secondary,
    colors.warning,
    colors.primary,
  ];
  let next = 0;
  const styles = new Map<string, SeriesStyle>();
  for (const series of overview.size_series) {
    const destination = destinations.get(series.destination_id);
    if (destination?.kind === "local")
      styles.set(series.destination_id, { color: colors.subtle, dashed: true });
    else if (destination?.health === "failing")
      styles.set(series.destination_id, { color: danger });
    else
      styles.set(series.destination_id, {
        color: palette[next++ % palette.length]!,
      });
  }
  const data: SizeSeries[] = overview.size_series
    .map((series) => ({
      id: series.name,
      destinationId: series.destination_id,
      data: series.points
        .map((point) => ({
          x: Math.round(
            (Date.parse(`${point.day}T00:00:00`) - today.getTime()) / DAY_MS,
          ),
          y: point.bytes / GB,
        }))
        .filter((point) => point.x >= -90 && point.x <= 0)
        .sort((a, b) => a.x - b.x),
    }))
    .filter((series) => series.data.length);
  const max = niceMax(
    Math.max(0, ...data.flatMap((s) => s.data.map((p) => p.y))),
  );
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const dayLabel = (offset: number) =>
    offset === 0
      ? "Today"
      : formatDay(new Date(today.getTime() + offset * DAY_MS).toISOString());
  const styleFor = (id: string | number) => {
    const series = data.find((s) => s.id === id);
    return (
      styles.get(series?.destinationId ?? "") ?? { color: colors.secondary }
    );
  };

  function SizeLines({
    series,
    lineGenerator,
  }: LineCustomSvgLayerProps<SizeSeries>) {
    return (
      <g>
        {series.map((s) => {
          const style = styleFor(s.id);
          return (
            <path
              key={s.id}
              d={lineGenerator(s.data.map((d) => d.position)) ?? ""}
              fill="none"
              stroke={style.color}
              strokeWidth={1.25}
              strokeDasharray={style.dashed ? "4 4" : undefined}
            />
          );
        })}
      </g>
    );
  }

  if (!data.length)
    return (
      <p className="font-mono text-label text-text-subtle">
        No off-site copy in the last 90 days yet.
      </p>
    );
  return (
    <div className="space-y-4">
      <InstrumentChartLegend
        items={data.map((series) => ({
          id: series.destinationId,
          label: series.id,
          ...styleFor(series.id),
        }))}
      />
      <div
        role="img"
        aria-label="Repository size, last 90 days"
        className="h-56 min-w-0"
      >
        <ResponsiveLine
          data={data}
          theme={theme}
          animate={false}
          margin={{ top: 12, right: 16, bottom: 28, left: 56 }}
          xScale={{ type: "linear", min: -90, max: 0 }}
          yScale={{ type: "linear", min: 0, max }}
          curve="monotoneX"
          enableGridX={false}
          gridYValues={ticks}
          enablePoints={false}
          pointSize={0}
          useMesh={false}
          isInteractive={false}
          axisLeft={{
            tickSize: 0,
            tickPadding: 8,
            tickValues: ticks,
            format: (value) => `${Number(value).toFixed(max < 4 ? 1 : 0)} GB`,
          }}
          axisBottom={{
            tickSize: 0,
            tickPadding: 8,
            tickValues: [-90, -60, -30, 0],
            format: (value) => dayLabel(Number(value)),
          }}
          layers={["grid", "axes", SizeLines]}
        />
      </div>
    </div>
  );
}
