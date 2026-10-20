import { BandcampPageView } from "./BandcampPageView";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";

import { MediaGrid } from "@crate/ui/domain/lists";
import { EmptyState } from "@crate/ui/domain/states";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { BandcampItem as BandcampItemView } from "@/components/bandcamp/BandcampItem";
import type {
  BandcampCollectionResponse,
  BandcampConnectionStatus,
  BandcampItem,
  BandcampRadarResponse,
  BandcampTaskResponse,
} from "./bandcamp-model";

export function Bandcamp() {
  const { t } = useTranslation();
  const status = useApi<BandcampConnectionStatus>("/api/bandcamp/me/status");
  const collection = useApi<BandcampCollectionResponse>(
    "/api/bandcamp/me/collection",
  );
  const wishlist = useApi<BandcampCollectionResponse>(
    "/api/bandcamp/me/wishlist",
  );
  const radar = useApi<BandcampRadarResponse>("/api/bandcamp/me/radar");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const refreshAll = useCallback(() => {
    status.refetch();
    collection.refetch();
    wishlist.refetch();
    radar.refetch();
  }, [collection, radar, status, wishlist]);

  async function queueTask(path: string, busyKey: string, taskLabel: string) {
    setBusyAction(busyKey);
    try {
      const response = await api<BandcampTaskResponse>(path, "POST");
      notify.success(
        t("bandcamp.toasts.taskQueued", {
          task: taskLabel,
          taskId: response.task_id,
        }),
      );
      refreshAll();
    } catch (error) {
      notify.error(
        (error as Error).message || t("bandcamp.toasts.queueFailed"),
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function importItem(item: BandcampItem) {
    const itemId = item.bandcamp_item_id ?? item.id;
    if (!itemId) return;
    setBusyAction(`import:${item.id}`);
    try {
      const response = await api<BandcampTaskResponse>(
        "/api/bandcamp/me/imports",
        "POST",
        { bandcamp_item_id: itemId, format: "flac" },
      );
      notify.success(
        t("bandcamp.toasts.importQueued", { taskId: response.task_id }),
      );
      refreshAll();
    } catch (error) {
      notify.error(
        (error as Error).message || t("bandcamp.toasts.importFailed"),
      );
    } finally {
      setBusyAction(null);
    }
  }

  const connected = status.data?.connected === true;
  const recentOwned = collection.data?.items.slice(0, 8) ?? [];
  const radarItems = radar.data?.items.slice(0, 8) ?? [];
  const wishlistItems = wishlist.data?.items.slice(0, 6) ?? [];
  const profileName =
    status.data?.display_name ||
    status.data?.username ||
    t("bandcamp.connection.accountFallback");

  const reads = [status, collection, wishlist, radar];
  const readState = reads.some((read) => read.error && !read.data)
    ? "error"
    : reads.some((read) => read.loading && !read.data)
      ? "loading"
      : "ready";
  return (
    <BandcampPageView
      readState={readState}
      connected={connected}
      profileName={profileName}
      connectionError={status.data?.last_error}
      busyAction={busyAction}
      totals={{
        owned: collection.data?.total ?? 0,
        wishlist: wishlist.data?.total ?? 0,
        radar: radar.data?.total ?? 0,
      }}
      radar={
        <ItemList
          items={radarItems}
          busyAction={busyAction}
          onImport={importItem}
          empty={t("bandcamp.empty.radar")}
        />
      }
      owned={
        <ItemGrid
          items={recentOwned}
          busyAction={busyAction}
          onImport={importItem}
          empty={t("bandcamp.empty.owned")}
        />
      }
      wishlist={
        <ItemGrid
          items={wishlistItems}
          busyAction={busyAction}
          onImport={importItem}
          empty={t("bandcamp.empty.wishlist")}
        />
      }
      onSync={() =>
        void queueTask(
          "/api/bandcamp/me/sync",
          "sync",
          t("bandcamp.tasks.sync"),
        )
      }
      onRefreshRadar={() =>
        void queueTask(
          "/api/bandcamp/me/radar/refresh",
          "radar",
          t("bandcamp.tasks.radar"),
        )
      }
      onRetry={refreshAll}
    />
  );
}

function ItemGrid({
  items,
  busyAction,
  onImport,
  empty,
}: {
  items: BandcampItem[];
  busyAction: string | null;
  onImport: (item: BandcampItem) => void;
  empty: string;
}) {
  if (!items.length)
    return <EmptyState variant="dashed" message={empty} className="py-6" />;
  return (
    <MediaGrid density="wide">
      {items.map((item) => (
        <BandcampItemView
          key={`${item.id}-${item.item_url}`}
          variant="tile"
          item={item}
          busyAction={busyAction}
          onImport={onImport}
        />
      ))}
    </MediaGrid>
  );
}

function ItemList({
  items,
  busyAction,
  onImport,
  empty,
}: {
  items: BandcampItem[];
  busyAction: string | null;
  onImport: (item: BandcampItem) => void;
  empty: string;
}) {
  if (!items.length)
    return <EmptyState variant="dashed" message={empty} className="py-6" />;
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <BandcampItemView
          key={`${item.id}-${item.item_url}`}
          variant="row"
          item={item}
          busyAction={busyAction}
          onImport={onImport}
        />
      ))}
    </div>
  );
}
