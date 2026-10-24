import { TooltipHint } from "@crate/ui/shadcn/tooltip";
import { formatRelativeTime } from "@/lib/utils";

export function RelativeTime({
  value,
  now,
}: {
  value: string | null | undefined;
  now?: number;
}) {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  if (!value || Number.isNaN(timestamp)) return <span>—</span>;
  const effectiveNow = now ?? Date.now();
  return (
    <TooltipHint content={new Date(timestamp).toLocaleString()}>
      <time dateTime={value} tabIndex={0}>
        {formatRelativeTime(value, "en", effectiveNow)}
      </time>
    </TooltipHint>
  );
}
