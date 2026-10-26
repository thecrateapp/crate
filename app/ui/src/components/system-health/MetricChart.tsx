import { useMemo, useState } from "react";
import { ResponsiveLine } from "@nivo/line";
import { useMotionAllowed } from "@crate/ui/lib/motion-gate";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crate/ui/shadcn/select";
import {
  InstrumentChartLegend,
  InstrumentChartPoint,
  InstrumentChartReadout,
  useInstrumentChartTheme,
} from "@/components/charts/InstrumentChart";
import {
  buildMetricSeries,
  metricFieldLabel,
  type MetricSample,
  type MetricStream,
} from "./metric-stream-model";

export function MetricChart({
  stream,
  data,
  intervalSeconds,
}: {
  stream: MetricStream;
  data: MetricSample[];
  intervalSeconds: number;
}) {
  const { colors, theme } = useInstrumentChartTheme();
  const motionAllowed = useMotionAllowed();
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const series = useMemo(
    () => buildMetricSeries(data, stream.fields, intervalSeconds),
    [data, stream.fields, intervalSeconds],
  );
  const samples = series[0]?.data ?? [];
  const [sampleIdentity, setSampleIdentity] = useState({
    data,
    intervalSeconds,
  });
  if (
    sampleIdentity.data !== data ||
    sampleIdentity.intervalSeconds !== intervalSeconds
  ) {
    setSampleIdentity({ data, intervalSeconds });
    setHovered(null);
    if (
      sampleIdentity.intervalSeconds !== intervalSeconds ||
      !samples.some((sample) => String(sample.x) === selected)
    )
      setSelected(null);
  }
  const selectedTime = selected == null ? null : Number(selected);
  const inspected = samples.find(
    (point) => point.x === (hovered ?? selectedTime),
  );
  const color = (field: string) =>
    stream.warning
      ? colors.warning
      : field === "max"
        ? colors.secondary
        : colors.accent;
  const timestamp = (value: number) =>
    new Date(value).toISOString().replace("T", " ").replace("Z", " UTC");
  return (
    <section
      aria-label={stream.title}
      data-slot="metric-chart"
      className="min-w-0 space-y-3 border-t border-border-quiet py-5"
    >
      <header className="space-y-1">
        <MonoLabel as="h3" tone="accent">
          {stream.title}
        </MonoLabel>
        <p className="font-mono text-label text-text-muted break-words">
          {stream.unit} · {intervalSeconds === 60 ? "60 s" : "3,600 s"} buckets
        </p>
        <p className="font-mono text-label text-text-subtle">
          Current bucket may be incomplete.
        </p>
      </header>
      <InstrumentChartLegend
        items={stream.fields.map((field) => ({
          id: field,
          label: metricFieldLabel(field),
          color: color(field),
          dashed: field === "max",
        }))}
      />
      <div className="h-48" aria-label={`${stream.title} chronological plot`}>
        {!samples.length ? (
          <EmptyState title="No samples" className="h-48" />
        ) : (
          <ResponsiveLine
            data={series}
            theme={theme}
            animate={motionAllowed}
            margin={{ top: 12, right: 16, bottom: 28, left: 48 }}
            xScale={{ type: "linear", min: "auto", max: "auto" }}
            yScale={{ type: "linear", min: 0, max: "auto" }}
            colors={({ id }) => color(String(id))}
            curve="linear"
            lineWidth={1.25}
            enableArea={false}
            pointSize={0}
            enableGridX={false}
            gridYValues={3}
            axisLeft={{ tickSize: 0, tickPadding: 8, tickValues: 3 }}
            axisBottom={{
              tickSize: 0,
              tickPadding: 8,
              tickValues:
                samples.length > 1
                  ? [
                      ...new Set([
                        samples[0]!.x,
                        (samples[0]!.x + samples[samples.length - 1]!.x) / 2,
                        samples[samples.length - 1]!.x,
                      ]),
                    ]
                  : samples.map((sample) => sample.x),
              format: (value) =>
                new Date(Number(value)).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
            }}
            enablePoints={false}
            isInteractive={false}
            layers={[
              "grid",
              "axes",
              ({ series: lines, innerWidth, innerHeight, xScale }) => (
                <g>
                  {lines.map((line) => (
                    <g key={line.id}>
                      {/* Segment paths explicitly so absent observations remain gaps. */}
                      {line.data.map((point, index) => {
                        const next = line.data[index + 1];
                        if (
                          point.data.y == null ||
                          !next ||
                          next.data.y == null ||
                          Number(next.data.x) - Number(point.data.x) >
                            intervalSeconds * 1000
                        )
                          return null;
                        return (
                          <path
                            key={`line-${index}`}
                            d={`M${point.position.x},${point.position.y}L${next.position.x},${next.position.y}`}
                            fill="none"
                            stroke={color(String(line.id))}
                            strokeWidth={1.25}
                            opacity={
                              (hovered ?? selectedTime) != null &&
                              Number(point.data.x) !==
                                (hovered ?? selectedTime) &&
                              Number(next.data.x) !== (hovered ?? selectedTime)
                                ? 0.35
                                : 1
                            }
                            strokeDasharray={
                              line.id === "max" ? "4 4" : undefined
                            }
                          />
                        );
                      })}
                    </g>
                  ))}
                  <g data-slot="metric-visible-nodes">
                    {lines.flatMap((line) =>
                      line.data
                        .filter((point) => point.data.y != null)
                        .map((point, index) => (
                          <InstrumentChartPoint
                            key={`${line.id}-${index}`}
                            x={point.position.x}
                            y={point.position.y}
                            color={color(String(line.id))}
                            muted={
                              (hovered ?? selectedTime) != null &&
                              Number(point.data.x) !== (hovered ?? selectedTime)
                            }
                            selected={
                              Number(point.data.x) === (hovered ?? selectedTime)
                            }
                          />
                        )),
                    )}
                  </g>
                  <rect
                    data-slot="metric-plot-interaction"
                    width={innerWidth}
                    height={innerHeight}
                    fill="transparent"
                    onPointerMove={(event) => {
                      const bounds =
                        event.currentTarget.getBoundingClientRect();
                      const x =
                        ((event.clientX - bounds.left) / bounds.width) *
                        innerWidth;
                      const nearest = samples.reduce<
                        (typeof samples)[number] | null
                      >(
                        (best, sample) =>
                          best == null ||
                          Math.abs(xScale(sample.x) - x) <
                            Math.abs(xScale(best.x) - x)
                            ? sample
                            : best,
                        null,
                      );
                      setHovered(nearest?.x ?? null);
                    }}
                    onPointerLeave={() => setHovered(null)}
                    onClick={(event) => {
                      const bounds =
                        event.currentTarget.getBoundingClientRect();
                      const x =
                        ((event.clientX - bounds.left) / bounds.width) *
                        innerWidth;
                      const nearest = samples.reduce<
                        (typeof samples)[number] | null
                      >(
                        (best, sample) =>
                          best == null ||
                          Math.abs(xScale(sample.x) - x) <
                            Math.abs(xScale(best.x) - x)
                            ? sample
                            : best,
                        null,
                      );
                      if (nearest) setSelected(String(nearest.x));
                      setHovered(null);
                    }}
                  />
                </g>
              ),
            ]}
          />
        )}
      </div>
      {samples.length > 0 && (
        <Select
          value={selected ?? ""}
          onValueChange={(value) => {
            setSelected(value);
            setHovered(null);
          }}
        >
          <SelectTrigger
            aria-label={`Inspect ${stream.title} sample`}
            className="w-full"
          >
            <SelectValue placeholder="Inspect a sample" />
          </SelectTrigger>
          <SelectContent>
            {samples.map((sample) => (
              <SelectItem key={sample.x} value={String(sample.x)}>
                {timestamp(sample.x)}
                {sample.y == null ? " · No samples" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <InstrumentChartReadout
        label={inspected ? timestamp(inspected.x) : "Select a sample"}
        items={stream.fields.map((field, index) => ({
          label: metricFieldLabel(field),
          value: inspected
            ? (series[index]?.data.find((point) => point.x === inspected.x)
                ?.y ?? "No samples")
            : "—",
          unit: stream.unit,
        }))}
      />
    </section>
  );
}
