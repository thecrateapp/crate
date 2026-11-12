import { useTranslation } from "react-i18next";
import { EmptyState } from "@crate/ui/domain/states";
import { Button } from "@crate/ui/shadcn/button";

export function SearchNoResultsState({
  message,
  onSearchAgain,
}: {
  /** Network coverage when the network was asked; it never claims absence. */
  message?: string;
  onSearchAgain?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <EmptyState
      variant="inline"
      titleAs="p"
      title={t("search.noMusicFound")}
      message={message ?? t("search.noMusicHint")}
      action={
        onSearchAgain ? (
          <Button variant="outline" onClick={onSearchAgain}>
            {t("search.network.again")}
          </Button>
        ) : undefined
      }
    />
  );
}
