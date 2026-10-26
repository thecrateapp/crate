import { useId } from "react";
import { ResponsiveBar, type BarTooltipProps } from "@nivo/bar";

import { formatCount, type DailyUsagePoint } from "@/lib/ai-models";

const CAPTION = "Daily calls, last 30 days";
const KEYS = ["Completed", "Failed"];
// The SystemHealth chart palette: cyan for work done, red for failures.
const CYAN = "#06b6d4";
const RED = "#f87171";
const COLORS: Record<string, string> = { Completed: CYAN, Failed: RED };
const TICK_EVERY_DAYS = 7;

/** Nivo needs an index-signature-compatible datum, which interfaces are not. */
type ChartDatum = {
  day: string;
  Completed: number;
  Failed: number;
  tokens: number;
};

const dayFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function shortDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? day : dayFormatter.format(date);
}

function UsageTooltip({ data }: Pick<BarTooltipProps<ChartDatum>, "data">) {
  return (
    <div className="rounded-sm border border-white/10 bg-panel-surface/95 px-3 py-2 text-xs text-white shadow-[0_18px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      {shortDay(data.day)}: {formatCount(data.Completed + data.Failed)} calls ·{" "}
      {formatCount(data.tokens)} tokens
    </div>
  );
}

export function UsageChart({ series }: { series: DailyUsagePoint[] }) {
  const captionId = useId();
  const data: ChartDatum[] = series.map(
    ({ day, Completed, Failed, tokens }) => ({
      day,
      Completed,
      Failed,
      tokens,
    }),
  );
  // One tick a week, counted back from today so the latest day is labelled.
  const tickValues = data
    .filter((_, index) => (data.length - 1 - index) % TICK_EVERY_DAYS === 0)
    .map((point) => point.day);

  return (
    <figure aria-labelledby={captionId} className="space-y-2">
      <figcaption id={captionId} className="text-sm font-medium text-white">
        {CAPTION}
      </figcaption>
      <div role="img" aria-label={CAPTION} className="h-48">
        <ResponsiveBar
          data={data}
          keys={KEYS}
          indexBy="day"
          groupMode="stacked"
          margin={{ top: 8, right: 16, bottom: 32, left: 40 }}
          padding={0.3}
          colors={({ id }) => COLORS[String(id)] ?? CYAN}
          enableLabel={false}
          enableGridX={false}
          gridYValues={4}
          axisLeft={{ tickSize: 0, tickPadding: 8, tickValues: 4 }}
          axisBottom={{
            tickSize: 0,
            tickPadding: 8,
            tickValues,
            format: (value) => shortDay(String(value)),
          }}
          theme={{
            text: { fill: "rgba(255,255,255,0.4)", fontSize: 10 },
            grid: { line: { stroke: "rgba(255,255,255,0.06)" } },
            tooltip: {
              container: {
                background: "transparent",
                border: "none",
                boxShadow: "none",
                padding: 0,
              },
            },
          }}
          tooltip={UsageTooltip}
        />
      </div>
    </figure>
  );
}
