import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@crate/ui/shadcn/card";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { Music2, Pencil } from "@crate/ui/icons";
import { CatalogSearchView } from "../components/search/CatalogSearchView";
import type { SearchResult } from "./paths-model";
export function PathEndpointPanelView({
  label,
  selected,
  onChange,
  query,
  onQueryChange,
  results,
  searching,
  error,
  onRetry,
  onSelect,
  disabled,
  renderImage,
}: {
  label: string;
  selected: SearchResult | null;
  onChange: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  results: SearchResult[];
  searching: boolean;
  error?: string;
  onRetry?: () => void;
  onSelect: (result: SearchResult) => void;
  disabled?: boolean;
  renderImage?: ComponentProps<typeof MediaCover>["renderImage"];
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent>
        {selected ? (
          <FormField kind="group" label={label}>
            {(group) => (
              <div
                {...group}
                role="group"
                className="flex min-w-0 items-center gap-4"
              >
                <MediaCover
                  src={selected.imageUrl}
                  alt=""
                  shape={selected.type === "artist" ? "circle" : "square"}
                  fallbackIcon={Music2}
                  size={96}
                  renderImage={renderImage}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-text-primary wrap-anywhere">
                    {selected.label}
                  </p>
                  <MonoLabel>
                    {t(
                      selected.type === "genre"
                        ? "common.genre"
                        : `search.resultType.${selected.type}`,
                    )}
                  </MonoLabel>
                </div>
                <ActionGroup>
                  <ActionButton
                    label={t("common.change")}
                    onClick={onChange}
                    disabled={disabled}
                  >
                    <Pencil aria-hidden="true" />
                  </ActionButton>
                </ActionGroup>
              </div>
            )}
          </FormField>
        ) : (
          <CatalogSearchView
            label={label}
            placeholder={t("paths.endpoint.placeholder")}
            query={query}
            onQueryChange={onQueryChange}
            items={results.map((item) => ({
              key: `${item.type}:${item.value}`,
              kind: item.type,
              title: item.label,
              imageUrl: item.imageUrl,
              data: item,
            }))}
            kinds={["genre", "artist", "album", "track"]}
            searching={searching}
            error={error}
            onRetry={onRetry}
            disabled={disabled}
            onSelect={(item) => onSelect(item.data)}
            renderImage={renderImage}
          />
        )}
      </CardContent>
    </Card>
  );
}
