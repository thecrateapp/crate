import { useTranslation } from "react-i18next";
import type { ComponentProps } from "react";
import { CatalogSearchView } from "../components/search/CatalogSearchView";
import type { CatalogSearchItem } from "../components/search/catalog-search-model";
import type { SearchResult } from "./radio-types";
import { Card, CardContent } from "@crate/ui/shadcn/card";

export function RadioSeedPanelView({
  query,
  searching,
  results,
  starting,
  onQueryChange,
  onStartSeeded,
  error,
  onRetry,
  renderImage,
}: {
  query: string;
  searching: boolean;
  results: SearchResult[];
  starting: boolean;
  onQueryChange: (query: string) => void;
  onStartSeeded: (seed: SearchResult) => void;
  error?: string;
  onRetry?: () => void;
  renderImage?: ComponentProps<typeof CatalogSearchView>["renderImage"];
}) {
  const { t } = useTranslation();
  const items: CatalogSearchItem<SearchResult>[] = results.map((result) => ({
    key: `${result.type}:${result.value}`,
    kind: result.type,
    title: result.label,
    imageUrl: result.imageUrl,
    data: result,
  }));
  return (
    <Card>
      <CardContent>
        <CatalogSearchView
          label={t("radio.seed.title")}
          placeholder={t("radio.seed.placeholder")}
          query={query}
          onQueryChange={onQueryChange}
          items={items}
          kinds={["genre", "artist", "album"]}
          searching={searching}
          disabled={starting}
          error={error}
          onRetry={onRetry}
          onSelect={(item) => onStartSeeded(item.data)}
          renderImage={renderImage}
        />
      </CardContent>
    </Card>
  );
}
