import { useMemo, type ReactNode, type SVGAttributes } from "react";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { cn } from "@crate/ui/lib/cn";
import { useChartColors } from "@/hooks/use-chart-colors";
import "./instrument-chart.css";

/** Statistical plots share the same quiet drawing recipe as Listen instruments. */
export function useInstrumentChartTheme() {
  const colors = useChartColors();
  const theme = useMemo(
    () => ({
      text: {
        fill: colors.secondary,
        fontFamily: "var(--font-mono-stack)",
        fontSize: 11,
      },
      axis: {
        domain: { line: { stroke: "transparent" } },
        ticks: {
          line: { stroke: "transparent" },
          text: { fill: colors.subtle, fontSize: 11 },
        },
        legend: { text: { fill: colors.subtle, fontSize: 11 } },
      },
      grid: { line: { stroke: colors.border, strokeWidth: 1 } },
      crosshair: {
        line: {
          stroke: colors.accent,
          strokeWidth: 1,
          strokeDasharray: "2 4",
        },
      },
      legends: { text: { fill: colors.secondary, fontSize: 11 } },
      labels: { text: { fill: colors.primary, fontSize: 11 } },
      tooltip: {
        container: {
          background: colors.surface,
          color: colors.primary,
          border: `1px solid ${colors.border}`,
          borderRadius: 0,
          boxShadow: "none",
          fontFamily: "var(--font-mono-stack)",
          fontSize: 11,
          padding: 12,
        },
      },
    }),
    [colors],
  );
  return { colors, theme };
}

interface InstrumentChartPointProps extends SVGAttributes<SVGGElement> {
  x?: number;
  y?: number;
  size?: number;
  color: string;
  selected?: boolean;
  muted?: boolean;
}

/** Domain adapters own event handling and the larger invisible hit target. */
export function InstrumentChartPoint({
  x = 0,
  y = 0,
  size,
  color,
  selected = false,
  muted = false,
  className,
  ...props
}: InstrumentChartPointProps) {
  return (
    <g
      {...props}
      color={color}
      transform={`translate(${x}, ${y})`}
      data-selected={selected || undefined}
      data-muted={(muted && !selected) || undefined}
      className={cn("instrument-chart-point", className)}
    >
      <circle
        r={(size ?? (selected ? 10 : 7)) / 2}
        fill={selected ? color : "var(--surface-app)"}
        stroke={color}
        strokeWidth={1.25}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

export interface InstrumentChartReading {
  label: string;
  value: ReactNode;
  unit?: string;
  fullWidth?: boolean;
}

export function InstrumentChartReadout({
  label,
  items,
  tone = "subtle",
}: {
  label: string;
  items: readonly InstrumentChartReading[];
  tone?: "subtle" | "accent";
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex min-w-0 flex-col gap-3"
    >
      <MonoLabel as="div" tone={tone}>
        {label}
      </MonoLabel>
      <dl className="m-0 flex min-w-0 flex-wrap gap-x-8 gap-y-3">
        {items.map((item) => (
          <div
            key={item.label}
            className={cn(
              "flex min-w-0 flex-col gap-1.5",
              item.fullWidth && "w-full basis-full",
            )}
          >
            <MonoLabel as="dt">{item.label}</MonoLabel>
            <dd className="m-0 wrap-anywhere font-mono text-sm font-normal tabular-nums text-text-primary">
              {item.value}
              {item.unit ? (
                <span className="ml-1.5 text-label text-text-subtle">
                  {item.unit}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function InstrumentChartLegend({
  items,
}: {
  items: readonly {
    id: string;
    label: string;
    color: string;
    dashed?: boolean;
  }[];
}) {
  return (
    <ul
      aria-label="Chart legend"
      className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0"
    >
      {items.map((item) => (
        <li
          key={item.id}
          data-series={item.id}
          className="flex items-center gap-2"
        >
          <svg
            data-admin-instrument="chart-series-legend"
            aria-hidden="true"
            width={22}
            height={10}
            viewBox="0 0 22 10"
          >
            <line
              x1={0}
              x2={22}
              y1={5}
              y2={5}
              stroke={item.color}
              strokeWidth={1.25}
              strokeDasharray={item.dashed ? "3 4" : undefined}
            />
          </svg>
          <MonoLabel as="span">{item.label}</MonoLabel>
        </li>
      ))}
    </ul>
  );
}
