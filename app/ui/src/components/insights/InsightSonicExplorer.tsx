import { useId, useState, type PointerEvent } from "react";
import { ResponsiveScatterPlot } from "@nivo/scatterplot";
import { Button } from "@crate/ui/shadcn/button";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
import {
  InstrumentChartLegend,
  InstrumentChartReadout,
  useInstrumentChartTheme,
} from "@/components/charts/InstrumentChart";
import { InsightSonicReading, SonicTrackCover } from "./InsightSonicReading";
import {
  minutes,
  number,
  percent,
  type InsightsWindow,
  type SonicCell,
  type SonicPlane,
  type SonicReport,
} from "./insights-model";

type Cohort = "contrast" | "catalogue" | "listening";
// Eight vertical bins can produce .125 / .625 boundaries. The region label must
// preserve those actual bounds rather than reuse the one-decimal summary recipe.
const boundary = (value: number) =>
  new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(value);
const range = (min: number, max: number, unit: string) =>
  `${boundary(min)}–${boundary(max)}${unit ? ` ${unit}` : ""}`;
const sonicShare = (value: number) =>
  value > 0 && value < 0.1 ? "<0.1%" : percent(value);
function defaultRegion(cells: SonicCell[]) {
  return cells.reduce<SonicCell | undefined>((best, cell) => {
    if (!best || cell.heard_tracks > best.heard_tracks) return cell;
    if (cell.heard_tracks !== best.heard_tracks) return best;
    if (cell.tracks > best.tracks) return cell;
    if (cell.tracks === best.tracks && cell.id < best.id) return cell;
    return best;
  }, undefined);
}
const cellLabel = (cell: SonicCell, plane: SonicPlane) =>
  `${range(cell.x_min, cell.x_max, plane.x.unit)} · ${range(
    cell.y_min,
    cell.y_max,
    plane.y.unit,
  )} · ${number(cell.tracks)} tracks · ${number(cell.heard_tracks)} heard`;

export function InsightSonicExplorer({
  report,
  window,
  onRefresh,
  refreshing,
  active = true,
  ruled = true,
}: {
  report: SonicReport | null | undefined;
  window: InsightsWindow;
  onRefresh: () => void;
  refreshing: boolean;
  active?: boolean;
  ruled?: boolean;
}) {
  const [planeKey, setPlaneKey] = useState<SonicPlane["key"]>("tempo_energy");
  const [cohort, setCohort] = useState<Cohort>("contrast");
  const [selection, setSelection] = useState<string | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<{
    cell: string;
    id: number;
  } | null>(null);
  const plane =
    report?.planes.find((item) => item.key === planeKey) ?? report?.planes[0];
  const selected =
    plane?.cells.find((cell) => cell.id === selection) ??
    defaultRegion(plane?.cells ?? []);
  const track =
    selected?.examples.find(
      (item) =>
        selectedTrack?.cell === selected.id && item.id === selectedTrack.id,
    ) ?? selected?.examples[0];
  return (
    <InstrumentPanel
      as="section"
      ruled={ruled}
      className={ruled ? undefined : "pt-0"}
      headingLevel={2}
      label={{ tone: "accent", children: "Sonic explorer" }}
      description="Where your indexed collection sits and which sounds you actually heard. Each region counts every eligible track; the examples are a bounded reading of that complete population."
      actions={
        plane ? (
          <SegmentedControl
            as="radio"
            label="Sonic plane"
            value={plane.key}
            items={
              report?.planes.map((item) => ({
                value: item.key,
                label:
                  item.key === "tempo_energy"
                    ? "Tempo × energy"
                    : "Tempo × LUFS",
              })) ?? []
            }
            onValueChange={(value) => {
              setPlaneKey(value);
              setSelection(null);
            }}
          />
        ) : undefined
      }
    >
      {!report ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">
            Sonic measurements are not included in this snapshot. Refresh to
            prepare the sonic report.
          </p>
          <Button variant="secondary" disabled={refreshing} onClick={onRefresh}>
            {refreshing ? "Preparing sonic report" : "Refresh sonic report"}
          </Button>
        </div>
      ) : plane ? (
        <div className="flex flex-col gap-6">
          <InstrumentChartReadout
            label="Sonic measurement coverage"
            items={[
              {
                label: "Paired catalogue",
                value: `${number(plane.coverage.paired_tracks)} / ${number(
                  plane.coverage.catalogue_tracks,
                )} indexed tracks`,
              },
              {
                label: "Paired listening",
                value: `${number(
                  plane.coverage.paired_heard_tracks,
                )} / ${number(plane.coverage.heard_tracks)} heard tracks`,
              },
            ]}
          />
          <div className="flex flex-col gap-2">
            <MonoLabel as="p" className="wrap-anywhere">
              Current Smart Mix profiles · {report.source.analyzer_version} ·
              profile {report.source.profile_version} · Full and Partial
            </MonoLabel>
            {plane.key === "tempo_lufs" ? (
              <MonoLabel as="p" className="wrap-anywhere">
                Verified LUFS · measurement {report.source.measurement_version}
              </MonoLabel>
            ) : null}
            <p className="text-xs text-text-muted">
              Only tracks with both valid measurements enter this plane. Missing
              values stay uncovered. Listening counts unique heard tracks, not
              plays.
            </p>
          </div>
          {selected ? (
            <div className="grid min-w-0 gap-x-10 gap-y-7 xl:grid-cols-[minmax(0,1.4fr)_minmax(17rem,1fr)]">
              <div className="min-w-0 flex flex-col gap-5">
                <SegmentedControl<Cohort>
                  as="radio"
                  label="Sonic comparison cohort"
                  value={cohort}
                  onValueChange={setCohort}
                  items={[
                    { value: "contrast", label: "Contrast" },
                    { value: "catalogue", label: "Catalogue" },
                    { value: "listening", label: "Heard tracks" },
                  ]}
                />
                <SonicMap
                  plane={plane}
                  cohort={cohort}
                  selected={selected}
                  onSelect={setSelection}
                />
                <InstrumentChartReadout
                  label="Selected sonic region"
                  tone="accent"
                  items={[
                    {
                      label: plane.x.label,
                      value: range(
                        selected.x_min,
                        selected.x_max,
                        plane.x.unit,
                      ),
                    },
                    {
                      label: plane.y.label,
                      value: range(
                        selected.y_min,
                        selected.y_max,
                        plane.y.unit,
                      ),
                    },
                    {
                      label: "Catalogue",
                      value: `${number(selected.tracks)} tracks · ${number(
                        selected.albums,
                      )} albums`,
                      unit: `${sonicShare(
                        selected.catalogue_share,
                      )} of paired catalogue`,
                    },
                    {
                      label: "Heard",
                      value: `${number(
                        selected.heard_tracks,
                      )} tracks · ${number(selected.heard_albums)} albums`,
                      unit: plane.coverage.paired_heard_tracks
                        ? `${sonicShare(
                            selected.listening_share,
                          )} of paired heard tracks`
                        : "No paired listening",
                    },
                    {
                      label: "Registered listening",
                      value: `${number(selected.plays)} plays · ${minutes(
                        selected.minutes,
                      )}`,
                    },
                  ]}
                />
                <div className="flex flex-col gap-3">
                  <MonoLabel as="h3" tone="accent">
                    Region examples
                  </MonoLabel>
                  <p className="text-xs text-text-muted">
                    Up to six deterministic examples of this entire counted
                    region, mixing heard and unheard tracks where available.
                  </p>
                  {selected.examples.length ? (
                    <HairlineList>
                      {selected.examples.map((item) => (
                        <HairlineRow
                          key={item.id}
                          asChild
                          truncate={false}
                          active={track?.id === item.id}
                        >
                          <button
                            type="button"
                            aria-label={`Inspect ${item.title} by ${item.artist}`}
                            aria-pressed={track?.id === item.id}
                            onClick={() =>
                              setSelectedTrack({
                                cell: selected.id,
                                id: item.id,
                              })
                            }
                            className="group min-h-11 outline-offset-4 hover:text-accent-action-hi aria-pressed:text-accent-action-hi"
                          >
                            <span className="flex min-w-0 items-start gap-3">
                              <SonicTrackCover track={item} />
                              <span className="min-w-0 flex flex-col gap-1">
                                <span className="wrap-anywhere font-display">
                                  {item.title}
                                </span>
                                <MonoLabel as="span" className="wrap-anywhere">
                                  {item.artist} · {item.year ?? "Year unknown"}
                                </MonoLabel>
                                <span className="text-xs text-text-muted">
                                  {item.heard
                                    ? `${number(item.plays)} registered plays`
                                    : "No plays in this period"}
                                </span>
                              </span>
                            </span>
                          </button>
                        </HairlineRow>
                      ))}
                    </HairlineList>
                  ) : (
                    <p className="text-sm text-text-muted">
                      No track examples available.
                    </p>
                  )}
                </div>
              </div>
              {track ? (
                <InsightSonicReading
                  track={track}
                  window={window}
                  active={active}
                />
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-text-muted">
              No current paired measurements are available for this plane.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-text-muted">
          No sonic planes are available.
        </p>
      )}
    </InstrumentPanel>
  );
}

function SonicMap({
  plane,
  cohort,
  selected,
  onSelect,
}: {
  plane: SonicPlane;
  cohort: Cohort;
  selected: SonicCell;
  onSelect: (id: string) => void;
}) {
  const { colors, theme } = useInstrumentChartTheme();
  const hintId = useId();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = plane.cells.find((cell) => cell.id === previewId) ?? selected;
  const index = plane.cells.findIndex((cell) => cell.id === selected.id);
  const maxShare = Math.max(
    1,
    ...plane.cells.flatMap((cell) => [
      cell.catalogue_share,
      cell.listening_share,
    ]),
  );
  const margin = { top: 16, right: 12, bottom: 44, left: 42 };
  function cellAtPointer(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - margin.left;
    const y = event.clientY - rect.top - margin.top;
    const width = rect.width - margin.left - margin.right;
    const height = rect.height - margin.top - margin.bottom;
    if (x < 0 || y < 0 || x > width || y > height) return;
    const column = Math.min(
      plane.x.bins - 1,
      Math.floor((x / width) * plane.x.bins),
    );
    const row = Math.min(
      plane.y.bins - 1,
      Math.floor((1 - y / height) * plane.y.bins),
    );
    return plane.cells.find(
      (cell) => cell.column === column && cell.row === row,
    );
  }
  return (
    <div className="min-w-0 flex flex-col gap-3">
      <InstrumentChartLegend
        items={[
          ...(cohort !== "listening"
            ? [
                {
                  id: "catalogue",
                  label: "Paired catalogue tracks",
                  color: colors.secondary,
                },
              ]
            : []),
          ...(cohort !== "catalogue"
            ? [
                {
                  id: "listening",
                  label: "Paired heard tracks",
                  color: colors.accent,
                },
              ]
            : []),
        ]}
      />
      <p className="text-xs text-text-muted">
        Area = paired unique-track share · one size scale for both cohorts, up
        to {percent(maxShare)}. Positions and axes stay fixed across listening
        periods.
      </p>
      <MonoLabel as="p" tone="accent" className="wrap-anywhere">
        {plane.y.label}
        {plane.y.unit ? ` · ${plane.y.unit}` : ""}
      </MonoLabel>
      <div
        role="slider"
        aria-label="Inspect sonic region"
        aria-describedby={hintId}
        aria-orientation="horizontal"
        tabIndex={0}
        aria-valuemin={1}
        aria-valuemax={plane.cells.length}
        aria-valuenow={index + 1}
        aria-valuetext={cellLabel(selected, plane)}
        className="h-[22.5rem] min-w-0 outline-offset-4"
        onKeyDown={(event) => {
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? plane.cells.length - 1
                : event.key === "ArrowRight" || event.key === "ArrowUp"
                  ? Math.min(plane.cells.length - 1, index + 1)
                  : event.key === "ArrowLeft" || event.key === "ArrowDown"
                    ? Math.max(0, index - 1)
                    : null;
          if (next !== null) {
            event.preventDefault();
            setPreviewId(null);
            onSelect(plane.cells[next]!.id);
          }
        }}
        onPointerMove={(event) => {
          if (event.pointerType !== "touch")
            setPreviewId(cellAtPointer(event)?.id ?? null);
        }}
        onPointerLeave={() => setPreviewId(null)}
        onPointerUp={(event) => {
          const cell = cellAtPointer(event);
          if (cell) {
            onSelect(cell.id);
            setPreviewId(null);
          }
        }}
      >
        <ResponsiveScatterPlot
          data={[
            {
              id: "regions",
              data: plane.cells.map((cell) => ({
                x: (cell.x_min + cell.x_max) / 2,
                y: (cell.y_min + cell.y_max) / 2,
                cell,
              })),
            },
          ]}
          margin={margin}
          xScale={{
            type: "linear",
            min: plane.x.min,
            max: plane.x.max,
            nice: false,
          }}
          yScale={{
            type: "linear",
            min: plane.y.min,
            max: plane.y.max,
            nice: false,
          }}
          axisBottom={{
            tickSize: 0,
            tickPadding: 9,
            tickValues: 4,
            legend: `${plane.x.label} · ${plane.x.unit}`,
            legendOffset: 36,
            legendPosition: "middle",
          }}
          axisLeft={{ tickSize: 0, tickPadding: 8, tickValues: 4 }}
          theme={theme}
          animate={false}
          isInteractive={false}
          enableGridX
          enableGridY
          gridXValues={5}
          gridYValues={5}
          layers={[
            "grid",
            "axes",
            ({ nodes, innerWidth, innerHeight }) => (
              <g
                data-admin-instrument="insights-sonic-regions"
                aria-hidden="true"
              >
                {nodes.map((node) => {
                  const cell = node.data.cell;
                  const radius = Math.max(
                    1,
                    Math.min(
                      25,
                      (innerWidth / plane.x.bins) * 0.48,
                      (innerHeight / plane.y.bins) * 0.48,
                    ),
                  );
                  const pinned = selected.id === cell.id;
                  const previewing = preview.id === cell.id;
                  return (
                    <g
                      key={cell.id}
                      data-sonic-cell={cell.id}
                      transform={`translate(${node.x},${node.y})`}
                      opacity={pinned || previewing ? 1 : 0.65}
                    >
                      {cohort !== "listening" && cell.catalogue_share > 0 ? (
                        <circle
                          data-sonic-cohort="catalogue"
                          r={
                            radius * Math.sqrt(cell.catalogue_share / maxShare)
                          }
                          fill="none"
                          stroke={colors.secondary}
                          strokeWidth={1.25}
                        />
                      ) : null}
                      {cohort !== "catalogue" && cell.listening_share > 0 ? (
                        <circle
                          data-sonic-cohort="listening"
                          r={
                            radius * Math.sqrt(cell.listening_share / maxShare)
                          }
                          fill={colors.accent}
                          fillOpacity={0.2}
                          stroke={colors.accent}
                          strokeWidth={1.25}
                        />
                      ) : null}
                      {pinned || previewing ? (
                        <circle
                          r={radius + 3}
                          fill="none"
                          stroke={colors.accent}
                          strokeWidth={pinned ? 1.5 : 1}
                          strokeDasharray={pinned ? undefined : "2 3"}
                        />
                      ) : null}
                    </g>
                  );
                })}
              </g>
            ),
          ]}
        />
      </div>
      <p className="min-h-10 text-xs text-text-secondary" aria-live="off">
        {preview.id !== selected.id ? "Preview · " : "Pinned · "}
        {cellLabel(preview, plane)}
      </p>
      <p id={hintId} className="text-xs text-text-muted">
        {number(plane.cells.length)} occupied regions · Hover to preview; tap to
        pin. Arrow keys inspect regions; Home and End select the first and last.
      </p>
    </div>
  );
}
