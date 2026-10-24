import { EntityRow, EntityAvatar } from "@crate/ui/domain/entity";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { artistPhotoApiUrl } from "@/lib/library-routes";

interface ShowPriceRange {
  min: number;
  max: number;
  currency: string;
}
export interface ArtistShowEvent {
  id: string;
  artist_id?: number;
  artist_slug?: string;
  name: string;
  date: string;
  local_date: string;
  venue: string;
  city: string;
  region: string;
  country: string;
  country_code: string;
  url: string;
  image: string;
  lineup: string[];
  price_range?: ShowPriceRange | null;
  status: string;
}
interface ArtistShowsSectionProps {
  artistName: string;
  artistId?: number;
  artistSlug?: string;
  shows: ArtistShowEvent[];
}

export function ArtistShowsSection({
  artistName,
  artistId,
  artistSlug,
  shows,
}: ArtistShowsSectionProps) {
  if (!shows.length)
    return (
      <p className="py-8 text-sm text-text-muted">
        No upcoming shows available
      </p>
    );
  return (
    <div className="space-y-[var(--content-list-gap)]">
      {shows.map((show) => {
        const date = show.date
          ? new Date(show.date + (show.date.includes("T") ? "" : "T12:00:00"))
          : null;
        const dateText = date
          ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
          : show.local_date;
        const support = show.lineup.filter(
          (name) => name.toLowerCase() !== artistName.toLowerCase(),
        );
        return (
          <EntityRow
            key={show.id || `${show.date}-${show.name}-${show.venue}`}
            title={show.name || show.venue}
            href={show.url || undefined}
            external={Boolean(show.url)}
            openLabel={
              show.url
                ? `Open tickets for ${show.name || show.venue}`
                : undefined
            }
            menuButton="none"
            leading={
              <EntityAvatar
                src={artistPhotoApiUrl({ artistId, artistSlug, artistName })}
                name={artistName}
                alt=""
                size="lg"
                shape="rounded"
              />
            }
            subtitle={
              <MonoLabel
                as="span"
                meta={[
                  show.venue,
                  [show.city, show.country].filter(Boolean).join(", "),
                ]}
              />
            }
            meta={
              support.length ? (
                <MonoLabel as="span">with {support.join(", ")}</MonoLabel>
              ) : undefined
            }
            trailing={
              <>
                <div className="space-y-1 text-right">
                  <MonoLabel as="span" tone="accent">
                    {dateText}
                  </MonoLabel>
                  {show.price_range ? (
                    <MonoLabel>
                      {show.price_range.min}–{show.price_range.max}{" "}
                      {show.price_range.currency}
                    </MonoLabel>
                  ) : null}
                </div>
                {show.status === "onsale" ? (
                  <InfoBadge tone="accent">On Sale</InfoBadge>
                ) : null}
              </>
            }
          />
        );
      })}
    </div>
  );
}
