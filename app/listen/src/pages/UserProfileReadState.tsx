import { useTranslation } from "react-i18next";
import { LoadingState } from "@crate/ui/domain/states";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
export function UserProfileReadState({
  loading,
  error,
  status,
  onRetry,
}: {
  loading: boolean;
  error: boolean;
  status?: number | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (loading)
    return (
      <LoadingState variant="page" label={t("userProfile.loadingLabel")} />
    );
  const missing = status === 404 || !error;
  return (
    <ErrorState
      kind={missing ? "notFound" : "error"}
      title={t(missing ? "userProfile.notFound" : "people.loadFailed")}
      onRetry={!missing ? onRetry : undefined}
      retryLabel={t("common.retry")}
      backTo="/people"
      backLabel={t("userProfile.backToPeople")}
    />
  );
}
