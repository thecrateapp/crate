import { Link } from "react-router";
import { EntityCard } from "@crate/ui/domain/entity/EntityCard";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";

interface MissingAlbumCardProps {
  title: string;
  year: string;
  type: string;
  artist?: string;
}
export function MissingAlbumCard({
  title,
  year,
  type,
  artist,
}: MissingAlbumCardProps) {
  const target = `/download?q=${encodeURIComponent(`${artist || ""} ${title}`.trim())}`;
  return (
    <div className="min-w-0">
      <EntityCard
        title={title}
        subtitle={year || "Year unknown"}
        href={target}
        layout="grid"
        menuButton="none"
        cover={{ alt: title }}
        meta={<InfoBadge>{type}</InfoBadge>}
      />
      <Link
        to={target}
        className="inline-flex min-h-11 items-center px-3 text-sm text-text-muted hover:text-accent-action-hi"
      >
        Search
      </Link>
    </div>
  );
}
