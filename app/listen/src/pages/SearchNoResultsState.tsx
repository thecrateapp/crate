import { useTranslation } from "react-i18next";
import { Search } from "@crate/ui/icons";
import { EmptyState } from "@crate/ui/domain/states";

export function SearchNoResultsState() {
  const { t } = useTranslation();

  return (
    <EmptyState
      variant="panel"
      icon={Search}
      titleAs="p"
      title={t("search.noMusicFound")}
      message={t("search.noMusicHint")}
      className="mx-auto max-w-sm"
    />
  );
}
