import { cn } from "@crate/ui/lib/cn";

export type SeverityTone =
  "debug" | "info" | "warn" | "error" | "critical" | "neutral";

const TONES: Record<string, SeverityTone> = {
  debug: "debug",
  trace: "debug",
  info: "info",
  low: "info",
  safe: "info",
  warn: "warn",
  warning: "warn",
  medium: "warn",
  caution: "warn",
  error: "error",
  high: "error",
  destructive: "error",
  critical: "critical",
  fatal: "critical",
};

const TONE_CLASS: Record<SeverityTone, string> = {
  debug: "text-text-subtle",
  info: "text-accent-action-hi",
  warn: "text-state-warning-text",
  error: "text-state-danger-text",
  critical: "text-state-danger-text",
  neutral: "text-text-secondary",
};

export function severityTone(level?: string | null): SeverityTone {
  return TONES[level?.trim().toLowerCase() || ""] ?? "neutral";
}

export function SeverityMeter({
  level,
  label,
  className,
}: {
  level?: string | null;
  label: string;
  className?: string;
}) {
  const tone = severityTone(level);
  return (
    <span
      data-slot="severity"
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-2 font-mono text-label uppercase tracking-caps whitespace-nowrap",
        TONE_CLASS[tone],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full bg-current",
          tone === "critical" && "outline-1 outline-offset-2 outline-current",
        )}
      />
      {label}
    </span>
  );
}
