import type { ReactNode } from "react";
import { Link } from "react-router";
import { StatNumber } from "@crate/ui/primitives/StatNumber";

export function ProfileMetric({
  label,
  value,
  to,
}: {
  label: string;
  value: string | number;
  to?: string;
}) {
  const reading = <StatNumber value={value} label={label} size="sm" />;
  return to ? (
    <Link
      data-slot="profile-metric"
      to={to}
      aria-label={`${label}: ${value}`}
      className="inline-flex min-h-11 min-w-0 items-start link-accent"
    >
      {reading}
    </Link>
  ) : (
    <div data-slot="profile-metric" className="flex min-w-0 items-start">
      {reading}
    </div>
  );
}

/** One responsive column contract for the social and listening metric bands. */
export function ProfileMetricsGrid({ children }: { children: ReactNode }) {
  return (
    <div
      data-slot="profile-metrics-grid"
      className="grid min-w-0 grid-cols-2 gap-6 border-t border-border-quiet pt-6 sm:grid-cols-3"
    >
      {children}
    </div>
  );
}
