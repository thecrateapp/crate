import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Download, Plus, Trash2 } from "@crate/ui/icons";

import { notify } from "@crate/ui/lib/notify";
import { IconButton } from "@crate/ui/primitives/IconButton";
import { Button } from "@crate/ui/shadcn/button";
import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import { EmptyState, LoadingState } from "@crate/ui/domain/states";
import { CrateImage } from "@/components/artwork/CrateImage";
import { useApi } from "@/hooks/use-api";
import { api, apiAssetUrl } from "@/lib/api";
import { contributionSourceLabel } from "@/lib/contributions";
import { openExternalUrl } from "@/lib/external-links";
import { albumCoverApiUrl } from "@/lib/library-routes";

import type {
  BandcampTaskResponse,
  ContributionsResponse,
  LibraryContribution,
} from "./library-model";
import {
  CONTRIBUTION_EXPORT_CLASS_NAME,
  CONTRIBUTION_WITHDRAW_CLASS_NAME,
  ContributionWithdrawDialog,
} from "./LibraryPrimitives";

function exportContribution(contribution: LibraryContribution) {
  void openExternalUrl(
    apiAssetUrl(`/api/me/contributions/${contribution.id}/export`),
  );
}

function ContributionArtwork({
  contribution,
}: {
  contribution: LibraryContribution;
}) {
  return (
    <div className=" size-14 shrink-0 overflow-hidden rounded-xl border border-text-primary/8 bg-text-primary/6">
      {contribution.album_id ? (
        <CrateImage
          src={albumCoverApiUrl(
            {
              albumId: contribution.album_id,
              albumEntityUid: contribution.album_entity_uid,
              artistName: contribution.artist_name,
              albumName: contribution.album_name,
            },
            { size: 128 },
          )}
          alt=""
          loading="lazy"
          className=" size-full object-cover"
        />
      ) : (
        <div className="flex size-full items-center justify-center text-accent-action/70">
          {contribution.source === "bandcamp" ? (
            <BandcampLogo size={20} />
          ) : (
            <Plus size={CRATE_ICON_SIZE.lg} />
          )}
        </div>
      )}
    </div>
  );
}

export function LibraryContributionsTab() {
  const { t } = useTranslation();
  const {
    data,
    loading,
    refetch: refetchContributions,
  } = useApi<ContributionsResponse>("/api/me/contributions");
  const [withdrawTarget, setWithdrawTarget] =
    useState<LibraryContribution | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  if (loading) return <LoadingState label={t("common.loadingShort")} />;

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
      <div className="rounded-panel border border-border-quiet bg-text-primary/[0.04] p-5">
        <h2 className="text-xl font-black text-text-primary">
          {t("library.contributions.title")}
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-text-muted">
          {t("library.contributions.description")}
        </p>
      </div>

      {!contributions.length ? (
        <EmptyState
          variant="dashed"
          title={t("library.contributions.emptyTitle")}
          description={t("library.contributions.empty")}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {contributions.map((contribution) => (
            <article
              key={contribution.id}
              className="flex items-center gap-3 rounded-xl border border-text-primary/8 bg-text-primary/[0.03] p-3"
            >
              <ContributionArtwork contribution={contribution} />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-black text-text-primary">
                  {contribution.album_name}
                </h3>
                <p className="truncate text-xs text-text-muted">
                  {contribution.artist_name}
                </p>
                <p className="mt-1 text-xs font-bold uppercase tracking-eyebrow text-accent-action/80">
                  {contributionSourceLabel(contribution.source)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                shape="pill"
                disabled={!contribution.album_id}
                onClick={() => exportContribution(contribution)}
                className={CONTRIBUTION_EXPORT_CLASS_NAME}
              >
                <Download size={CRATE_ICON_SIZE.xs} />
                {t("common.export")}
              </Button>
              <IconButton
                label={t("library.contributions.withdraw.confirm")}
                tone="danger"
                size="sm"
                onClick={() => setWithdrawTarget(contribution)}
                className={CONTRIBUTION_WITHDRAW_CLASS_NAME}
              >
                <Trash2 size={CRATE_ICON_SIZE.xs} />
              </IconButton>
            </article>
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
