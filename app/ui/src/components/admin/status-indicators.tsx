import { cn } from "@crate/ui/lib/cn";
const LEVELS: Record<string, number> = {
  safe: 1,
  low: 1,
  info: 1,
  caution: 2,
  medium: 2,
  warn: 2,
  warning: 2,
  destructive: 3,
  high: 3,
  error: 3,
  critical: 3,
  fatal: 3,
  debug: 0,
};
export function SeverityMeter({
  level,
  label,
  className,
}: {
  level?: string | null;
  label: string;
  className?: string;
}) {
  const active = LEVELS[level?.toLowerCase() || ""] ?? 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-mono text-meta text-text-secondary",
        className,
      )}
    >
      <span aria-hidden="true" className="inline-flex shrink-0 gap-0.5">
        {[1, 2, 3].map((segment) => (
          <span
            key={segment}
            data-segment={segment}
            data-active={segment <= active}
            className={cn(
              "h-1 w-2",
              segment <= active ? "bg-text-primary/55" : "bg-text-subtle/20",
            )}
          />
        ))}
      </span>
      {label}
    </span>
  );
}
