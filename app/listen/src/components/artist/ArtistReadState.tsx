import { useTranslation } from "react-i18next";
import { EmptyState, ErrorState, LoadingState } from "@crate/ui/domain/states";

export function ArtistReadState({
  loading,
  error,
  status,
  onRetry,
}: {
  loading: boolean;
  error: unknown;
  status: number | null | undefined;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (loading)
    return <LoadingState variant="route" label={t("artist.loading")} />;
  if (status === 404 || !error)
    return <EmptyState title={t("artist.notFound")} />;
  return (
    <ErrorState
      title={t("artist.unavailable")}
      onRetry={onRetry}
      retryLabel={t("common.retry")}
    />
  );
}
