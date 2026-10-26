import { ArtistDetailSection } from "./ArtistDetailSection";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { useState } from "react";
import { ErrorState, LoadingState } from "@crate/ui/domain/states";
import {
  ShowManagementRow,
  upcomingItemFromCachedShow,
  type CachedShowEvent,
} from "@/components/shows/ShowManagementRow";
import { useApi } from "@/hooks/use-api";

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
export function ArtistShowsSection({ artistName }: { artistName: string }) {
  const { data, loading, error, refetch } = useApi<{
    events: CachedShowEvent[];
  }>(`/api/shows/cached?limit=50&artist=${encodeURIComponent(artistName)}`);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const items = (data?.events ?? []).map(upcomingItemFromCachedShow);

  return (
    <ArtistDetailSection title="Upcoming Shows">
      {loading && !data ? (
        <LoadingState label="Loading shows" />
      ) : error && !data ? (
        <ErrorState
          message="Upcoming shows could not be loaded."
          onRetry={refetch}
        />
      ) : items.length === 0 ? (
        <EmptyState title="No upcoming shows available" />
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const key =
              item.show_id != null
                ? `show-${item.show_id}`
                : `show-${item.artist}-${item.venue}-${item.date}`;
            const expanded = expandedKey === key;
            return (
              <ShowManagementRow
                key={key}
                item={item}
                expanded={expanded}
                onToggle={() => setExpandedKey(expanded ? null : key)}
              />
            );
          })}
        </div>
      )}
    </ArtistDetailSection>
  );
}
