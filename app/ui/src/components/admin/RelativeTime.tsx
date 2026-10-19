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
    <time dateTime={value} title={new Date(timestamp).toLocaleString()}>
      {formatRelativeTime(value, "en", effectiveNow)}
    </time>
  );
}
