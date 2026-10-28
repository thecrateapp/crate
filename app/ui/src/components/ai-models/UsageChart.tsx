import { useEffect, useId, useState } from "react";
import { ResponsiveBar, type BarTooltipProps } from "@nivo/bar";

import { readCssColorToken } from "@crate/ui/lib/read-css-color";
import { useMotionAllowed } from "@crate/ui/lib/motion-gate";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

import { formatCount, type DailyUsagePoint } from "@/lib/ai-models";

const CAPTION = "Daily calls, last 30 days";
const KEYS = ["Completed", "Failed"];
function readChartColors() {
  const color = (token: `--${string}`) =>
    typeof document === "undefined"
      ? `var(${token})`
      : readCssColorToken(document.documentElement, token) || `var(${token})`;
  return {
    completed: color("--accent-action-hi"),
    failed: color("--state-danger"),
    text: color("--text-muted"),
    grid: color("--border-quiet"),
  };
}

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
    <div className="rounded-sm border border-border-quiet bg-surface-popover px-3 py-2 text-sm text-text-primary">
      {shortDay(data.day)}: {formatCount(data.Completed + data.Failed)} calls ·{" "}
      {formatCount(data.tokens)} tokens
    </div>
  );
}

export function UsageChart({ series }: { series: DailyUsagePoint[] }) {
  const captionId = useId();
  const motionAllowed = useMotionAllowed();
  const [colors, setColors] = useState(readChartColors);
  useEffect(() => {
    const update = () => setColors(readChartColors());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-crate-theme", "class"],
    });
    return () => observer.disconnect();
  }, []);
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
      <MonoLabel as="figcaption" id={captionId} tone="accent">
        {CAPTION}
      </MonoLabel>
      <div role="img" aria-label={CAPTION} className="h-48">
        <ResponsiveBar
          data={data}
          keys={KEYS}
          indexBy="day"
          groupMode="stacked"
          margin={{ top: 8, right: 16, bottom: 32, left: 40 }}
          padding={0.3}
          colors={({ id }) =>
            String(id) === "Failed" ? colors.failed : colors.completed
          }
          animate={motionAllowed}
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
            text: {
              fill: colors.text,
              fontSize: 12,
              fontFamily: "var(--font-mono)",
            },
            grid: { line: { stroke: colors.grid } },
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
