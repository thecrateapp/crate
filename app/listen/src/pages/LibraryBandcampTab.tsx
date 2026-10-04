import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";

import { EmptyState, LoadingState } from "@crate/ui/domain/states";
import { notify } from "@crate/ui/lib/notify";
import { useApi } from "@/hooks/use-api";
import { api, apiAssetUrl } from "@/lib/api";
import { openExternalUrl } from "@/lib/external-links";

import { LibraryBandcampHeader } from "./LibraryBandcampHeader";
import { LibraryBandcampImported } from "./LibraryBandcampImported";
import { LibraryBandcampPurchases } from "./LibraryBandcampPurchases";
import { ContributionWithdrawDialog } from "./LibraryPrimitives";
import type {
  BandcampCollectionResponse,
  BandcampItem,
  BandcampTaskResponse,
  ContributionsResponse,
  LibraryContribution,
} from "./library-model";

function exportContribution(contribution: LibraryContribution) {
  void openExternalUrl(
    apiAssetUrl(`/api/me/contributions/${contribution.id}/export`),
  );
}

export function LibraryBandcampTab() {
  const { t } = useTranslation();
  const {
    data: collection,
    loading: collectionLoading,
    refetch: refetchCollection,
  } = useApi<BandcampCollectionResponse>("/api/bandcamp/me/collection");
  const {
    data: contributions,
    loading: contributionsLoading,
    refetch: refetchContributions,
  } = useApi<ContributionsResponse>("/api/me/contributions?source=bandcamp");
  const { data: wishlist, loading: wishlistLoading } =
    useApi<BandcampCollectionResponse>("/api/bandcamp/me/wishlist");
  const [busyItemId, setBusyItemId] = useState<number | null>(null);
  const [withdrawTarget, setWithdrawTarget] =
    useState<LibraryContribution | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  async function importItem(item: BandcampItem) {
    const itemId = item.bandcamp_item_id ?? item.id;
    if (!itemId) return;
    setBusyItemId(item.id);
    try {
      const response = await api<BandcampTaskResponse>(
        "/api/bandcamp/me/imports",
        "POST",
        { bandcamp_item_id: itemId, format: "flac" },
      );
      notify.success(
        t("bandcamp.toasts.importQueued", { taskId: response.task_id }),
      );
      refetchCollection();
      refetchContributions();
    } catch (error) {
      notify.error(
        (error as Error).message || t("bandcamp.toasts.importFailed"),
      );
    } finally {
      setBusyItemId(null);
    }
  }

  async function withdrawContribution() {
    if (!withdrawTarget) return;
    setWithdrawing(true);
    try {
      const response = await api<BandcampTaskResponse>(
        `/api/me/contributions/${withdrawTarget.id}/withdraw`,
        "POST",
      );
      notify.success(
        t("library.bandcamp.toasts.removalQueued", {
          taskId: response.task_id,
        }),
      );
      setWithdrawTarget(null);
      refetchCollection();
      refetchContributions();
    } catch (error) {
      notify.error(
        (error as Error).message || t("library.bandcamp.toasts.removeFailed"),
      );
    } finally {
      setWithdrawing(false);
    }
  }

  const purchases = collection?.items ?? [];
  const importedContributions = contributions?.items ?? [];
  const wishlistCount = wishlist?.total ?? 0;

  if (collectionLoading || wishlistLoading || contributionsLoading) {
    return <LoadingState label={t("common.loadingShort")} />;
  }

  return (
    <div className="space-y-5">
      <LibraryBandcampHeader
        purchases={purchases.length}
        importedCount={importedContributions.length}
        wishlistCount={wishlistCount}
        title={t("library.bandcamp.title")}
        description={t("library.bandcamp.description")}
        purchasesLabel={t("library.bandcamp.stats.purchases")}
        importedLabel={t("library.bandcamp.stats.inCrate")}
        wishlistLabel={t("bandcamp.stats.wishlist")}
      />

      <LibraryBandcampImported
        contributions={importedContributions}
        title={t("library.bandcamp.imported.title")}
        description={t("library.bandcamp.imported.description")}
        exportLabel={t("common.export")}
        withdrawLabel={t("library.contributions.withdraw.confirm")}
        onExport={exportContribution}
        onWithdraw={setWithdrawTarget}
      />

      {!purchases.length ? (
        <div className="space-y-3">
          <EmptyState
            variant="inline"
            message={t("library.bandcamp.emptyPurchases")}
          />
          <Link
            to="/settings"
            className="inline-flex min-h-11 items-center rounded-full bg-accent-action px-4 text-sm font-bold text-accent-action-foreground"
          >
            {t("library.bandcamp.openSettings")}
          </Link>
        </div>
      ) : (
        <LibraryBandcampPurchases
          purchases={purchases}
          busyItemId={busyItemId}
          importedLabel={t("library.bandcamp.imported.badge")}
          onImport={importItem}
        />
      )}

      <ContributionWithdrawDialog
        open={Boolean(withdrawTarget)}
        pending={withdrawing}
        title={t("library.bandcamp.withdraw.title")}
        body={t("library.bandcamp.withdraw.description", {
          album: withdrawTarget?.album_name,
        })}
        onCancel={() => setWithdrawTarget(null)}
        onConfirm={withdrawContribution}
      />
    </div>
  );
}
