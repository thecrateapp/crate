export function formatEventDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const value = new Date(`${date}T12:00:00`);
  if (
    Number.isNaN(value.getTime()) ||
    value.getFullYear() !== Number(date.slice(0, 4)) ||
    value.getMonth() + 1 !== Number(date.slice(5, 7)) ||
    value.getDate() !== Number(date.slice(8, 10))
  )
    return null;
  return {
    month: value.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
    day: String(value.getDate()),
    weekday: value
      .toLocaleDateString("en-US", { weekday: "short" })
      .toUpperCase(),
    full: value.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
  };
}

export function EventDate({
  date,
  labelPrefix,
}: {
  date: string;
  labelPrefix?: string;
}) {
  const parts = formatEventDate(date);
  if (!parts)
    return (
      <span
        aria-label="Unknown date"
        title={date || "Unknown date"}
        className="inline-flex w-12 shrink-0 justify-center truncate font-mono text-xs text-text-secondary"
      >
        {date || "—"}
      </span>
    );
  const label = labelPrefix ? `${labelPrefix} · ${parts.full}` : parts.full;
  return (
    <time
      dateTime={date}
      aria-label={label}
      title={label}
      data-slot="event-date"
      className="flex w-12 shrink-0 flex-col items-center justify-center font-mono font-normal tabular-nums"
    >
      <span
        aria-hidden="true"
        className="text-micro leading-3 text-accent-action-hi/70"
      >
        {parts.month}
      </span>
      <span
        aria-hidden="true"
        className="text-2xl leading-7 text-accent-action-hi"
      >
        {parts.day}
      </span>
      <span
        aria-hidden="true"
        className="text-micro leading-3 text-text-secondary"
      >
        {parts.weekday}
      </span>
    </time>
  );
}
