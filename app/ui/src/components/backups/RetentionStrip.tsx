import { keptDays, type BackupLocalRetention } from "@/lib/backups";

const DAYS = 120;
const W = 720;
const BASE = 26;

/**
 * Hand-built instrument: which of the last 120 days still have a copy under
 * the retention counts. Short ticks are daily copies, medium weekly, tall
 * monthly (DS §3.5 instruments are SVG, not chart libraries).
 */
export function RetentionStrip({
  counts,
  today,
}: {
  counts: Pick<
    BackupLocalRetention,
    "keep_daily" | "keep_weekly" | "keep_monthly"
  >;
  today: Date;
}) {
  const kept = keptDays(counts, today, DAYS);
  const step = W / DAYS;
  return (
    <figure className="m-0 space-y-2">
      <svg
        role="img"
        aria-label={`Copies kept over the last ${DAYS} days: ${kept.size}`}
        viewBox={`0 0 ${W} 34`}
        width="100%"
        height="34"
        preserveAspectRatio="none"
      >
        <line
          x1={0}
          x2={W}
          y1={BASE}
          y2={BASE}
          stroke="var(--border-quiet)"
          strokeWidth={1}
        />
        {Array.from({ length: DAYS }, (_, day) => {
          const tier = kept.get(day);
          const x = W - (day + 0.5) * step;
          if (!tier)
            return (
              <line
                key={day}
                x1={x}
                x2={x}
                y1={BASE - 4}
                y2={BASE}
                stroke="var(--border-quiet)"
                strokeWidth={1}
              />
            );
          const height = tier === "monthly" ? 22 : tier === "weekly" ? 16 : 10;
          return (
            <line
              key={day}
              data-tier={tier}
              x1={x}
              x2={x}
              y1={BASE - height}
              y2={BASE}
              stroke={
                tier === "daily"
                  ? "var(--accent-action-hi)"
                  : tier === "weekly"
                    ? "var(--text-secondary)"
                    : "var(--text-primary)"
              }
              strokeWidth={2}
            />
          );
        })}
      </svg>
      <figcaption className="flex flex-wrap justify-between gap-2 font-mono text-label text-text-subtle">
        <span>{DAYS} days ago</span>
        <span>Short: daily · medium: weekly · tall: monthly</span>
        <span>Today</span>
      </figcaption>
    </figure>
  );
}
