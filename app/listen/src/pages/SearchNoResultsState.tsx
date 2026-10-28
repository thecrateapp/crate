import { useTranslation } from "react-i18next";
import { EmptyState } from "@crate/ui/domain/states";

export function SearchNoResultsState() {
  const { t } = useTranslation();

  return (
    <EmptyState
      variant="inline"
      titleAs="p"
      title={t("search.noMusicFound")}
      message={t("search.noMusicHint")}
    />
  );
}
