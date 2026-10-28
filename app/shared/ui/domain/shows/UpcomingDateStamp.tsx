import { MonoLabel } from "../../primitives/MonoLabel";

/** Local-calendar date stamp shared by both upcoming event row consumers. */
export function UpcomingDateStamp({
  date,
  locale,
}: {
  date: string;
  locale: string;
}) {
  const value = date ? new Date(`${date}T12:00:00`) : null;
  if (
    !value ||
    Number.isNaN(value.getTime()) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    value.getMonth() + 1 !== Number(date.slice(5, 7)) ||
    value.getDate() !== Number(date.slice(8, 10))
  )
    return null;

  return (
    <time
      data-slot="upcoming-date"
      dateTime={date}
      aria-label={value.toLocaleDateString(locale, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })}
      className="flex w-14 shrink-0 flex-col items-center justify-center gap-1 px-2"
    >
      <MonoLabel as="span" className="text-accent-action-hi">
        {value.toLocaleDateString(locale, { month: "short" })}
      </MonoLabel>
      <span className="font-display text-2xl font-bold leading-none tracking-display text-text-primary tabular-nums">
        {value.getDate()}
      </span>
      <MonoLabel as="span">
        {value.toLocaleDateString(locale, { weekday: "short" })}
      </MonoLabel>
    </time>
  );
}
