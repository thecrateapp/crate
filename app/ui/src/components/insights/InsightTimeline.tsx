import { useState } from "react";
import { ResponsiveLine } from "@nivo/line";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import {
  InstrumentChartLegend,
  InstrumentChartPoint,
  InstrumentChartReadout,
  useInstrumentChartTheme,
} from "@/components/charts/InstrumentChart";
import { minutes, type CollectionInsights } from "./insights-model";
export function InsightTimeline({ data }: { data: CollectionInsights }) {
  const { colors, theme } = useInstrumentChartTheme();
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const selected =
    data.timeline.find((day) => day.day === selectedDay) ??
    data.timeline[data.timeline.length - 1];
  const prior = data.period?.previous_complete === true;
  const series = [
    {
      id: "current",
      data: data.timeline.map((row) => ({ x: row.day, y: row.minutes })),
    },
    ...(prior
      ? [
          {
            id: "previous",
            data: data.timeline.map((row) => ({
              x: row.day,
              y: row.previous_minutes,
            })),
          },
        ]
      : []),
  ];
  return (
    <InstrumentPanel
      as="section"
      headingLevel={2}
      label={{ tone: "accent", children: "Listening pulse" }}
      description={`Registered local listening time by listener-local reported day.${
        prior ? " Previous period aligned by relative day." : ""
      } Select the trace by pointer or touch; use arrow keys when focused to read each day.`}
    >
      <InstrumentChartLegend
        items={[
          { id: "current", label: "Selected period", color: colors.accent },
          ...(prior
            ? [
                {
                  id: "previous",
                  label: "Previous period",
                  color: colors.secondary,
                  dashed: true,
                },
              ]
            : []),
        ]}
      />
      {selected ? (
        <>
          <div
            className="my-5 h-52 min-w-0"
            role="slider"
            tabIndex={0}
            aria-label="Inspect listening day"
            aria-orientation="horizontal"
            aria-valuemin={1}
            aria-valuemax={data.timeline.length}
            aria-valuenow={
              data.timeline.findIndex((day) => day.day === selected.day) + 1
            }
            aria-valuetext={`${selected.day}: ${minutes(selected.minutes)}${
              prior
                ? `, previous relative day ${minutes(
                    selected.previous_minutes,
                  )}`
                : ""
            }`}
            onKeyDown={(event) => {
              const index = data.timeline.findIndex(
                (day) => day.day === selected.day,
              );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? data.timeline.length - 1
                    : event.key === "ArrowRight" || event.key === "ArrowUp"
                      ? Math.min(data.timeline.length - 1, index + 1)
                      : event.key === "ArrowLeft" || event.key === "ArrowDown"
                        ? Math.max(0, index - 1)
                        : null;
              if (next !== null) {
                event.preventDefault();
                setSelectedDay(data.timeline[next]!.day);
              }
            }}
          >
            <ResponsiveLine
              data={series}
              margin={{ top: 12, right: 12, bottom: 26, left: 40 }}
              xScale={{ type: "point" }}
              yScale={{ type: "linear", min: 0, max: "auto" }}
              axisLeft={{ tickValues: 3, tickSize: 0, tickPadding: 8 }}
              axisBottom={{
                tickValues: data.timeline
                  .filter(
                    (_, index) =>
                      index %
                        Math.max(1, Math.ceil(data.timeline.length / 3)) ===
                      0,
                  )
                  .map((day) => day.day),
                format: (value) => String(value).slice(5),
                tickSize: 0,
                tickPadding: 10,
              }}
              enableGridX={false}
              gridYValues={3}
              theme={theme}
              tooltip={({ point }) => {
                const previous = point.seriesId === "previous";
                // The prior trace is aligned to current days on the X axis;
                // its reading must retain the actual date in the prior period.
                const day =
                  previous && data.period
                    ? new Date(
                        Date.parse(data.period.previous_start) +
                          point.indexInSeries * 86_400_000,
                      )
                        .toISOString()
                        .slice(0, 10)
                    : String(point.data.x);
                return (
                  <div
                    className="w-max max-w-[calc(100vw-2rem)]"
                    style={theme.tooltip.container}
                  >
                    <InstrumentChartReadout
                      label={`${
                        previous ? "Previous" : "Selected"
                      } period listening`}
                      items={[
                        { label: "Reported day", value: day },
                        {
                          label: "Registered time",
                          value: minutes(Number(point.data.y)),
                        },
                      ]}
                    />
                  </div>
                );
              }}
              animate={false}
              enablePoints={false}
              enableCrosshair={false}
              useMesh
              isInteractive
              onClick={(point) =>
                "data" in point && setSelectedDay(String(point.data.x))
              }
              onMouseMove={(point) =>
                "data" in point && setSelectedDay(String(point.data.x))
              }
              layers={[
                "grid",
                "axes",
                ({ series: drawn, lineGenerator, points }) => (
                  <g data-admin-instrument="insights-listening-trace">
                    {drawn.map((line) => (
                      <path
                        key={line.id}
                        fill="none"
                        d={
                          lineGenerator(
                            line.data.map((point) => point.position),
                          ) ?? undefined
                        }
                        stroke={
                          line.id === "current"
                            ? colors.accent
                            : colors.secondary
                        }
                        strokeWidth={1.25}
                        strokeDasharray={
                          line.id === "previous" ? "3 5" : undefined
                        }
                      />
                    ))}
                    {points
                      .filter((point) => String(point.data.x) === selected.day)
                      .map((point) => (
                        <InstrumentChartPoint
                          key={point.id}
                          x={point.x}
                          y={point.y}
                          color={
                            point.seriesId === "current"
                              ? colors.accent
                              : colors.secondary
                          }
                          selected={point.seriesId === "current"}
                          size={8}
                        />
                      ))}
                  </g>
                ),
                "mesh",
              ]}
            />
          </div>
          <InstrumentChartReadout
            label="Selected listening day"
            items={[
              { label: "Reported day", value: selected.day },
              { label: "Registered time", value: minutes(selected.minutes) },
              ...(prior
                ? [
                    {
                      label: "Previous relative day",
                      value: minutes(selected.previous_minutes),
                    },
                  ]
                : []),
            ]}
          />
        </>
      ) : (
        <p className="mt-5 text-sm text-text-muted">
          No listening days available.
        </p>
      )}
    </InstrumentPanel>
  );
}
