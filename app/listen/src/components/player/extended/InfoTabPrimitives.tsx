import type { ReactNode } from "react";
import { CRATE_ICON_SIZE, Star } from "@crate/ui/icons";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { Meter } from "@crate/ui/primitives/Meter";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatNumber } from "@crate/ui/primitives/StatNumber";

/** Domain adapters compose canonical foundations, without local visual recipes. */
export function MetricBar({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  if (value == null || !Number.isFinite(value)) return null;
  return (
    <Meter
      label={label}
      value={value}
      max={1}
      valueText={`${Math.round(Math.max(0, Math.min(value, 1)) * 100)}%`}
    />
  );
}
export function StatCard({
  label,
  value,
  helper,
  unit,
}: {
  label: string;
  value: string;
  helper?: string;
  unit?: string;
}) {
  return (
    <div className="grid min-w-0 content-start gap-2 wrap-anywhere">
      <StatNumber size="sm" value={value} label={label} unit={unit} />
      {helper ? <MonoLabel>{helper}</MonoLabel> : null}
    </div>
  );
}
export function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <InstrumentPanel
      as="section"
      headingLevel={3}
      label={{ children: title, tone: "accent" }}
      description={subtitle}
    >
      <div className="grid min-w-0 gap-4">{children}</div>
    </InstrumentPanel>
  );
}
export function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-1" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((score) => (
        <Star
          key={score}
          size={CRATE_ICON_SIZE.sm}
          className={
            score <= rating
              ? "fill-state-warning text-state-warning"
              : "text-text-faint"
          }
        />
      ))}
    </div>
  );
}
