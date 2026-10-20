import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CrateImage } from "@/components/artwork/CrateImage";
import { api } from "@/lib/api";
import {
  buildSearchResults,
  type RadioSearchResponse,
  type RadioGenre,
} from "./radio-model";
import {
  catalogTrackItem,
  type CatalogTrack,
} from "@/components/search/catalog-search-model";
import { PathEndpointPanelView } from "./PathEndpointPanelView";
import type { SearchResult } from "./paths-model";

export function EndpointPanel({
  side,
  selected,
  onSelect,
  disabled = false,
}: {
  side: "origin" | "destination";
  selected: SearchResult | null;
  onSelect: (result: SearchResult | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (query.trim().length < 2 || selected) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setError(false);
      try {
        const [catalog, genres] = await Promise.all([
          api<RadioSearchResponse & { tracks?: CatalogTrack[] }>(
            `/api/catalog/search?q=${encodeURIComponent(query)}&limit=5`,
          ),
          api<RadioGenre[]>("/api/genres"),
        ]);
        if (!active) return;
        const items: SearchResult[] = buildSearchResults(
          catalog,
          genres,
          query,
        );
        for (const track of catalog.tracks?.slice(0, 2) ?? []) {
          const item = catalogTrackItem(track);
          items.push({
            type: "track",
            value: track.entity_uid || String(track.id),
            label: [track.title, track.artist].filter(Boolean).join(" — "),
            imageUrl: item.imageUrl ?? undefined,
          });
        }
        setResults(items);
      } catch {
        if (active) {
          setError(true);
          setResults([]);
        }
      } finally {
        if (active) setSearching(false);
      }
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, selected, attempt]);
  const reset = () => {
    setQuery("");
    setResults([]);
    setSearching(false);
    setError(false);
  };
  return (
    <PathEndpointPanelView
      label={t(side === "origin" ? "paths.endpoint.from" : "paths.endpoint.to")}
      selected={selected}
      onChange={() => {
        onSelect(null);
        reset();
      }}
      query={query}
      onQueryChange={(value) => {
        setQuery(value);
        setResults([]);
        setError(false);
        setSearching(value.trim().length >= 2);
      }}
      results={results}
      searching={searching}
      error={error ? t("search.unavailableTitle") : undefined}
      onRetry={() => setAttempt((n) => n + 1)}
      onSelect={(item) => {
        onSelect(item);
        reset();
      }}
      disabled={disabled}
      renderImage={(props) => <CrateImage {...props} loading="lazy" />}
    />
  );
}
