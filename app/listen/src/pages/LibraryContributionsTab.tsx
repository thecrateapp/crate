import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";
import { EmptyState, ErrorState, LoadingState } from "@crate/ui/domain/states";
import { LibrarySection } from "@/components/library/LibrarySection";
import { LibraryContributionRow } from "@/components/library/LibraryContributionRow";
import { ContributionArtwork } from "@/components/library/ContributionArtwork";
import { useApi } from "@/hooks/use-api";
import { api, apiAssetUrl } from "@/lib/api";
import { contributionSourceLabel } from "@/lib/contributions";
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
      const response = await api<BandcampTaskResponse>(
        `/api/me/contributions/${withdrawTarget.id}/withdraw`,
        "POST",
      );
      notify.success(
        t("library.contributions.toasts.removalQueued", {
          taskId: response.task_id,
        }),
      );
      setWithdrawTarget(null);
      refetchContributions();
    } catch (error) {
      notify.error(
        (error as Error).message ||
          t("library.contributions.toasts.removeFailed"),
      );
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
        <div className="grid gap-3 md:grid-cols-2">
          {contributions.map((contribution) => (
            <LibraryContributionRow
              key={contribution.id}
              title={contribution.album_name}
              artist={contribution.artist_name}
              sourceLabel={contributionSourceLabel(contribution.source)}
              artwork={<ContributionArtwork contribution={contribution} />}
              exportLabel={t("common.export")}
              withdrawLabel={t("library.contributions.withdraw.confirm")}
              canExport={Boolean(contribution.album_id)}
              onExport={() => exportContribution(contribution)}
              onWithdraw={() => setWithdrawTarget(contribution)}
            />
          ))}
        </div>
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
