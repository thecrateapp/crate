import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";
import { MediaGrid } from "@crate/ui/domain/lists";
import { EmptyState, ErrorState, LoadingState } from "@crate/ui/domain/states";
import { LibrarySection } from "@/components/library/LibrarySection";
import { LibraryContributionItem } from "@/components/library/LibraryContributionItem";
import { useApi } from "@/hooks/use-api";
import { api, apiAssetUrl } from "@/lib/api";
import { openExternalUrl } from "@/lib/external-links";
import type {
  BandcampTaskResponse,
  ContributionsResponse,
  LibraryContribution,
} from "./library-model";
import { ContributionWithdrawDialog } from "@/components/library/ContributionWithdrawDialog";

export function LibraryContributionsTab() {
  const { t } = useTranslation();
  const {
    data,
    loading,
    error,
    refetch: refetchContributions,
  } = useApi<ContributionsResponse>("/api/me/contributions");
  const [withdrawTarget, setWithdrawTarget] =
    useState<LibraryContribution | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  function exportContribution(contribution: LibraryContribution) {
    void openExternalUrl(
      apiAssetUrl(`/api/me/contributions/${contribution.id}/export`),
    ).catch(() => notify.error(t("common.toasts.openExternalFailed")));
  }

  if (loading) return <LoadingState label={t("common.loadingShort")} />;

  if (error && !data)
    return (
      <ErrorState
        message={t("search.errors.tryAgain")}
        retryLabel={t("common.retry")}
        onRetry={refetchContributions}
      />
    );

  const contributions = data?.items ?? [];

  async function withdrawContribution() {
    if (!withdrawTarget) return;
    setWithdrawing(true);
    try {
      await api<BandcampTaskResponse>(
        `/api/me/contributions/${withdrawTarget.id}/withdraw`,
        "POST",
      );
      notify.success(
        t("library.contributions.toasts.removalQueued", {
          album: withdrawTarget.album_name,
        }),
      );
      setWithdrawTarget(null);
      refetchContributions();
    } catch {
      notify.error(t("library.contributions.toasts.removeFailed"));
    } finally {
      setWithdrawing(false);
    }
  }

  return (
    <div className="space-y-5">
      <LibrarySection
        title={t("library.contributions.title")}
        subtitle={t("library.contributions.description")}
      />

      {!contributions.length ? (
        <EmptyState
          variant="dashed"
          title={t("library.contributions.emptyTitle")}
          description={t("library.contributions.empty")}
        />
      ) : (
        <MediaGrid aria-label={t("nav.collection.contributions")}>
          {contributions.map((contribution) => (
            <LibraryContributionItem
              key={contribution.id}
              contribution={contribution}
              onExport={() => exportContribution(contribution)}
              onWithdraw={() => setWithdrawTarget(contribution)}
            />
          ))}
        </MediaGrid>
      )}

      <ContributionWithdrawDialog
        open={Boolean(withdrawTarget)}
        pending={withdrawing}
        title={t("library.contributions.withdraw.title")}
        body={t("library.contributions.withdraw.description", {
          album: withdrawTarget?.album_name,
        })}
        onCancel={() => setWithdrawTarget(null)}
        onConfirm={withdrawContribution}
      />
    </div>
  );
}
