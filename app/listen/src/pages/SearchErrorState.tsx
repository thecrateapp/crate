import { useTranslation } from "react-i18next";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
export function SearchErrorState({
  query,
  message,
  onRetry,
}: {
  query: string;
  message: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-8">
      <PageHeader size="md" title={t("search.resultsFor", { query })} />
      <ErrorState
        title={t("search.unavailable")}
        message={message}
        onRetry={onRetry}
        retryLabel={t("common.retry")}
      />
    </div>
  );
}
