import { useTranslation } from "react-i18next";
import { SearchFormView } from "./SearchFormView";
export function SearchEmptyState(props: {
  value: string;
  onChange: (value: string) => void;
  onSearch: (query: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <SearchFormView
      {...props}
      title={t("search.label")}
      prompt={t("search.emptyPrompt")}
      placeholder={t("search.placeholder")}
      clearLabel={t("search.clear")}
    />
  );
}
