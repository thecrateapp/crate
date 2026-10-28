import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { StatusDot } from "@crate/ui/primitives/StatusDot";

export interface NextShow {
  date: string;
  venue?: string | null;
  city?: string | null;
  url?: string | null;
}

export function nextShowLabel(show: NextShow) {
  const date = new Date(
    show.date + (show.date.includes("T") ? "" : "T12:00:00"),
  ).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const place = [show.venue, show.city].filter(Boolean).join(", ");
  return ["Next show", date, place].filter(Boolean).join(" · ");
}

export function NextShowBadge({
  show,
  className,
}: {
  show: NextShow;
  className?: string;
}) {
  const label = nextShowLabel(show);
  const badge = (
    <InfoBadge tone="accent">
      <StatusDot tone="on" />
      {label}
    </InfoBadge>
  );
  if (!show.url) return badge;
  return (
    <a
      href={show.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open next show listing: ${label}`}
      className={`inline-flex max-w-full rounded-full transition-opacity hover:opacity-80 ${className ?? ""}`}
    >
      {badge}
    </a>
  );
}
