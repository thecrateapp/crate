import { useState } from "react";
import { Link } from "react-router";
import { ResponsiveScatterPlot } from "@nivo/scatterplot";
import { Button } from "@crate/ui/shadcn/button";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import {
  InstrumentChartLegend,
  InstrumentChartPoint,
  InstrumentChartReadout,
  useInstrumentChartTheme,
} from "@/components/charts/InstrumentChart";
import { InsightAlbumList } from "./InsightEntityLists";
import {
  minutes,
  number,
  percent,
  type CollectionInsights,
  type InsightComparison as Comparison,
} from "./insights-model";

export function InsightComparison({ data }: { data: CollectionInsights }) {
  const [mode, setMode] = useState<"genres" | "decades">("genres");
  const [selection, setSelection] = useState<string | null>(null);
  const rows = data[mode];
  const selected = rows.find((row) => row.key === selection) ?? rows[0];
  const { colors } = useInstrumentChartTheme();
  return (
    <InstrumentPanel
      as="section"
      headingLevel={2}
      label={{ tone: "accent", children: "Collection versus listening" }}
      description="Catalogue share counts indexed tracks; listening share counts registered local plays. Canonical genres split each track and play equally across its mapped genres. Unknown metadata remains separate."
      actions={
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label="Collection comparison dimension"
        >
          {(["genres", "decades"] as const).map((value) => (
            <Button
              key={value}
              variant="ghost"
              aria-pressed={mode === value}
              onClick={() => {
                setMode(value);
                setSelection(null);
              }}
            >
              {value === "genres" ? "Genres" : "Decades"}
            </Button>
          ))}
        </div>
      }
    >
      <div className="mb-5">
        <InstrumentChartLegend
          items={[
            {
              id: "catalogue",
              label: "Indexed catalogue",
              color: colors.secondary,
            },
            {
              id: "listening",
              label: "Registered plays",
              color: colors.accent,
            },
          ]}
        />
      </div>
      {rows.length ? (
        <div className="grid min-w-0 gap-x-10 gap-y-7 xl:grid-cols-[minmax(0,1.4fr)_minmax(16rem,1fr)]">
          <ComparisonRails
            rows={rows}
            selected={selected?.key ?? null}
            onSelect={setSelection}
          />
          {selected ? (
            <div className="min-w-0 space-y-5">
              <InstrumentChartReadout
                label="Selected collection category"
                tone="accent"
                items={[
                  { label: "Category", value: selected.label, fullWidth: true },
                  {
                    label: "Catalogue",
                    value: percent(selected.catalogue_share),
                    unit: `of ${number(data.catalogue?.tracks ?? 0)} indexed tracks`,
                  },
                  {
                    label: "Listening",
                    value: percent(selected.listening_share),
                    unit: `of ${number(data.current?.plays ?? 0)} registered local plays`,
                  },
                  {
                    label: "Membership",
                    value: `${number(selected.tracks)} tracks · ${number(selected.albums)} albums`,
                    fullWidth: true,
                  },
                  {
                    label: "Tracks with listening",
                    value: number(selected.played_tracks),
                  },
                  { label: "Registered plays", value: number(selected.plays) },
                  {
                    label: "Registered time",
                    value: minutes(selected.minutes),
                  },
                  ...(data.period?.previous_complete
                    ? [
                        {
                          label: "Listening share change",
                          value: `${selected.listening_share - selected.previous_listening_share > 0 ? "+" : ""}${number(selected.listening_share - selected.previous_listening_share)} pp`,
                        },
                      ]
                    : []),
                ]}
              />
              {selected.genre_slug ? (
                <Link
                  className="inline-flex min-h-11 items-center text-sm text-accent-action-hi underline-offset-4 hover:underline"
                  to={`/genres?genre=${encodeURIComponent(selected.genre_slug)}`}
                >
                  Explore {selected.label}
                </Link>
              ) : null}
              {selected.examples.length ? (
                <InsightAlbumList albums={selected.examples} />
              ) : (
                <p className="text-sm text-text-muted">
                  No album examples available.
                </p>
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-text-muted">
          No collection categories available.
        </p>
      )}
    </InstrumentPanel>
  );
}

function ComparisonRails({
  rows,
  selected,
  onSelect,
}: {
  rows: Comparison[];
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const { colors, theme } = useInstrumentChartTheme();
  const height = rows.length * 52;
  const maximumShare = Math.max(
    0,
    ...rows
      .flatMap((row) => [row.catalogue_share, row.listening_share])
      .filter(Number.isFinite),
  );
  const step =
    maximumShare <= 1
      ? 0.25
      : maximumShare <= 5
        ? 1
        : maximumShare <= 25
          ? 5
          : maximumShare <= 50
            ? 10
            : 25;
  const domainMax = Math.min(
    100,
    Math.max(step, Math.ceil(maximumShare / step) * step),
  );
  // Row buttons own a full-width keyboard/touch target. Nivo keeps both endpoints on one scale,
  // including coincident points; category selection never depends on hitting a tiny SVG point.
  return (
    <div className="min-w-0">
      <div
        className="mb-2 grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[8rem_minmax(0,1fr)]"
        aria-hidden="true"
      >
        <span />
        <div className="flex justify-between border-b border-border-quiet pb-2">
          <MonoLabel>0%</MonoLabel>
          <MonoLabel>{percent(domainMax)}</MonoLabel>
        </div>
      </div>
      <div
        role="region"
        aria-label="Collection category rows"
        className="relative max-h-80 min-w-0 overflow-y-auto lg:max-h-[32rem]"
      >
        <div
          className="pointer-events-none absolute inset-y-0 right-0 left-[6.75rem] sm:left-[8.75rem]"
          style={{ height }}
          aria-hidden="true"
        >
          <ResponsiveScatterPlot
            data={[
              {
                id: "catalogue",
                data: rows.map((row, i) => ({
                  x: row.catalogue_share,
                  y: rows.length - 1 - i,
                  key: row.key,
                })),
              },
              {
                id: "listening",
                data: rows.map((row, i) => ({
                  x: row.listening_share,
                  y: rows.length - 1 - i,
                  key: row.key,
                })),
              },
            ]}
            margin={{ top: 26, right: 6, bottom: 26, left: 6 }}
            xScale={{ type: "linear", min: 0, max: domainMax, nice: false }}
            yScale={{
              type: "linear",
              min: 0,
              max: Math.max(1, rows.length - 1),
            }}
            axisBottom={null}
            axisLeft={null}
            enableGridX={false}
            enableGridY={false}
            theme={theme}
            animate={false}
            isInteractive={false}
            layers={[
              ({ nodes }) => (
                <g data-admin-instrument="insights-comparison-rails">
                  {rows.map((row) => {
                    const pair = nodes.filter(
                      (node) => node.data.key === row.key,
                    );
                    const [first, second] = pair;
                    return first && second ? (
                      <line
                        key={row.key}
                        x1={first.x}
                        x2={second.x}
                        y1={first.y}
                        y2={second.y}
                        stroke={colors.border}
                        strokeWidth={1.25}
                      />
                    ) : null;
                  })}
                </g>
              ),
              "nodes",
            ]}
            nodeComponent={({ node }) => (
              <InstrumentChartPoint
                x={node.x}
                y={node.y}
                color={
                  node.serieId === "listening"
                    ? colors.accent
                    : colors.secondary
                }
                selected={
                  node.data.key === selected && node.serieId === "listening"
                }
                muted={node.data.key !== selected}
                size={8}
              />
            )}
          />
        </div>
        <div className="relative">
          {rows.map((row) => (
            <button
              type="button"
              key={row.key}
              aria-label={`Inspect ${row.label}: catalogue ${percent(row.catalogue_share)}, listening ${percent(row.listening_share)}`}
              aria-pressed={row.key === selected}
              onFocus={() => onSelect(row.key)}
              onPointerEnter={() => onSelect(row.key)}
              onClick={() => onSelect(row.key)}
              className="grid h-[52px] min-h-11 w-full grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-3 border-b border-border-quiet-subtle text-left text-sm text-text-secondary outline-offset-2 hover:text-accent-action-hi aria-pressed:text-accent-action-hi sm:grid-cols-[8rem_minmax(0,1fr)]"
            >
              <span className="line-clamp-2 wrap-anywhere pr-1">
                {row.label}
              </span>
              <span aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
      <MonoLabel as="p" className="mt-3 wrap-anywhere">
        {number(rows.length)} categories shown · Select a row to read exact
        shares and album examples.
      </MonoLabel>
    </div>
  );
}
