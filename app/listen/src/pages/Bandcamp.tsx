import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Download,
  ExternalLink,
  Heart,
  Loader2,
  Radar,
  RefreshCw,
} from "@crate/ui/icons";
import type { LucideIcon } from "@crate/ui/icons";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import { api, resolveMaybeApiAssetUrl } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { cn } from "@/lib/utils";

interface BandcampConnectionStatus {
  connected: boolean;
  status: string;
  username?: string | null;
  display_name?: string | null;
  image_url?: string | null;
  last_success_at?: string | null;
  last_error?: string | null;
}

interface BandcampCollectionResponse {
  items: BandcampItem[];
  total: number;
}

interface BandcampRadarResponse {
  items: BandcampRadarItem[];
  total: number;
}

interface BandcampTaskResponse {
  task_id: string;
  status: string;
}

interface BandcampItem {
  id: number;
  bandcamp_item_id?: number | null;
  artist_name?: string | null;
  album_title?: string | null;
  track_title?: string | null;
  item_url?: string | null;
  cover_url?: string | null;
  owned?: boolean | null;
  downloadable?: boolean | null;
  latest_import_status?: string | null;
}

interface BandcampRadarItem extends BandcampItem {
  score?: number | null;
  status?: string | null;
  source?: string | null;
}

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

  const stats = useMemo(
    () => [
      {
        label: "Owned",
        labelText: t("bandcamp.stats.owned"),
        value: collection.data?.total ?? 0,
        icon: BandcampLogo,
      },
      {
        label: "Wishlist",
        labelText: t("bandcamp.stats.wishlist"),
        value: wishlist.data?.total ?? 0,
        icon: Heart,
      },
      {
        label: "Radar",
        labelText: t("bandcamp.stats.radar"),
        value: radar.data?.total ?? 0,
        icon: Radar,
      },
    ],
    [collection.data, radar.data, t, wishlist.data],
  );

  async function queueTask(path: string, label: string) {
    setBusyAction(label);
    try {
      const response = await api<BandcampTaskResponse>(path, "POST");
      toast.success(`${label} queued (${response.task_id})`);
      refreshAll();
    } catch (error) {
      toast.error((error as Error).message || `Failed to queue ${label}`);
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
      toast.success(`Bandcamp import queued (${response.task_id})`);
      refreshAll();
    } catch (error) {
      toast.error((error as Error).message || "Failed to import Bandcamp item");
    } finally {
      setBusyAction(null);
    }
  }

  const connected = status.data?.connected === true;
  const recentOwned = collection.data?.items.slice(0, 8) ?? [];
  const radarItems = radar.data?.items.slice(0, 8) ?? [];
  const wishlistItems = wishlist.data?.items.slice(0, 6) ?? [];
  const profileName =
    status.data?.display_name || status.data?.username || "Bandcamp account";

  return (
    <div className="mx-auto flex w-full max-w-[1560px] flex-col gap-8 px-4 py-6 md:px-8">
      <section className="relative overflow-hidden rounded-[2rem] border border-white/8 bg-[radial-gradient(circle_at_18%_18%,rgba(34,211,238,0.18),transparent_34%),linear-gradient(135deg,rgba(17,18,25,0.98),rgba(7,8,11,0.98))] p-6 md:p-8">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.045))]" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-black uppercase tracking-[0.24em] text-primary">
              <BandcampLogo className="h-3.5 w-3.5" />
              Bandcamp
            </div>
            <h1 className="mt-5 text-4xl font-black tracking-tight text-white md:text-6xl">
              {t("bandcamp.title")}
            </h1>
            <p className="mt-3 max-w-2xl text-base text-slate-400 md:text-lg">
              {t("bandcamp.subtitle")}
            </p>
            <ConnectionLine
              connected={connected}
              loading={status.loading}
              profileName={profileName}
              error={status.data?.last_error}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!connected || busyAction !== null}
              onClick={() =>
                queueTask("/api/bandcamp/me/sync", "Bandcamp sync")
              }
              className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-black text-black transition hover:bg-primary/90 disabled:opacity-50"
            >
              {busyAction === "Bandcamp sync" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {t("bandcamp.actions.sync")}
            </button>
            <button
              type="button"
              disabled={!connected || busyAction !== null}
              onClick={() =>
                queueTask("/api/bandcamp/me/radar/refresh", "Bandcamp Radar")
              }
              className="inline-flex h-11 items-center gap-2 rounded-full border border-white/12 bg-white/5 px-5 text-sm font-black text-white transition hover:bg-white/10 disabled:opacity-50"
            >
              <Radar className="h-4 w-4" />
              {t("bandcamp.actions.refreshRadar")}
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} label={stat.labelText} />
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Rail
          title={t("bandcamp.rails.radar.title")}
          subtitle={t("bandcamp.rails.radar.subtitle")}
        >
          <ItemGrid
            items={radarItems}
            busyAction={busyAction}
            onImport={importItem}
            empty={t("bandcamp.empty.radar")}
          />
        </Rail>
        <Rail
          title={t("bandcamp.rails.owned.title")}
          subtitle={t("bandcamp.rails.owned.subtitle")}
        >
          <ItemList
            items={recentOwned}
            busyAction={busyAction}
            onImport={importItem}
            empty={t("bandcamp.empty.owned")}
          />
        </Rail>
      </section>

      <Rail
        title={t("bandcamp.rails.wishlist.title")}
        subtitle={t("bandcamp.rails.wishlist.subtitle")}
      >
        <ItemGrid
          items={wishlistItems}
          busyAction={busyAction}
          onImport={importItem}
          empty={t("bandcamp.empty.wishlist")}
        />
      </Rail>
    </div>
  );
}

function ConnectionLine({
  connected,
  loading,
  profileName,
  error,
}: {
  connected: boolean;
  loading: boolean;
  profileName: string;
  error?: string | null;
}) {
  const { t } = useTranslation();
  if (loading && !connected) {
    return (
      <p className="mt-5 text-sm text-slate-500">
        {t("bandcamp.connection.checking")}
      </p>
    );
  }
  if (!connected) {
    return (
      <p className="mt-5 text-sm text-amber-200">
        {t("bandcamp.connection.notConnected")}
      </p>
    );
  }
  return (
    <p className="mt-5 text-sm text-slate-400">
      {t("bandcamp.connection.connectedAs")}{" "}
      <span className="font-bold text-white">{profileName}</span>
      {error ? (
        <span className="text-red-300">
          {" · "}
          {t("bandcamp.connection.lastError", { error })}
        </span>
      ) : null}
    </p>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: LucideIcon | typeof BandcampLogo;
}) {
  return (
    <div className="rounded-3xl border border-white/8 bg-white/[0.035] p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-black uppercase tracking-[0.24em] text-slate-500">
          {label}
        </span>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="mt-5 text-4xl font-black text-white">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function Rail({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[1.75rem] border border-white/8 bg-[#111117]/90 p-5">
      <div className="mb-5">
        <h2 className="text-2xl font-black text-white">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>
      {children}
    </section>
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
  if (!items.length) return <Empty label={empty} />;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <BandcampCard
          key={`${item.id}-${item.item_url}`}
          item={item}
          busyAction={busyAction}
          onImport={onImport}
        />
      ))}
    </div>
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
  if (!items.length) return <Empty label={empty} />;
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <BandcampListItem
          key={`${item.id}-${item.item_url}`}
          item={item}
          busyAction={busyAction}
          onImport={onImport}
        />
      ))}
    </div>
  );
}

function BandcampCard({
  item,
  busyAction,
  onImport,
}: {
  item: BandcampItem;
  busyAction: string | null;
  onImport: (item: BandcampItem) => void;
}) {
  return (
    <article className="group overflow-hidden rounded-3xl border border-white/8 bg-black/18">
      <Cover item={item} />
      <div className="space-y-3 p-4">
        <div className="min-w-0">
          <h3 className="truncate text-base font-black text-white">
            {itemTitle(item)}
          </h3>
          <p className="truncate text-sm text-slate-500">{item.artist_name}</p>
        </div>
        <ItemActions item={item} busyAction={busyAction} onImport={onImport} />
      </div>
    </article>
  );
}

function BandcampListItem({
  item,
  busyAction,
  onImport,
}: {
  item: BandcampItem;
  busyAction: string | null;
  onImport: (item: BandcampItem) => void;
}) {
  return (
    <article className="flex items-center gap-3 rounded-2xl border border-white/8 bg-black/18 p-3">
      <Cover item={item} compact />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-black text-white">
          {itemTitle(item)}
        </h3>
        <p className="truncate text-xs text-slate-500">{item.artist_name}</p>
      </div>
      <ItemActions
        item={item}
        busyAction={busyAction}
        onImport={onImport}
        compact
      />
    </article>
  );
}

function ItemActions({
  item,
  busyAction,
  onImport,
  compact = false,
}: {
  item: BandcampItem;
  busyAction: string | null;
  onImport: (item: BandcampItem) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const canImport =
    item.owned === true &&
    item.downloadable === true &&
    item.latest_import_status !== "completed";
  return (
    <div className={cn("flex gap-2", compact ? "shrink-0" : "flex-wrap")}>
      {canImport ? (
        <button
          type="button"
          disabled={busyAction !== null}
          onClick={() => onImport(item)}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-primary px-3 text-xs font-black text-black transition hover:bg-primary/90 disabled:opacity-50"
        >
          {busyAction === `import:${item.id}` ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          {!compact ? t("common.import") : null}
        </button>
      ) : null}
      {item.item_url ? (
        <button
          type="button"
          onClick={() => window.open(item.item_url || "", "_blank")}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 text-xs font-black text-white transition hover:bg-white/10"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {!compact ? t("common.open") : null}
        </button>
      ) : null}
    </div>
  );
}

function Cover({
  item,
  compact = false,
}: {
  item: BandcampItem;
  compact?: boolean;
}) {
  const coverUrl = resolveMaybeApiAssetUrl(item.cover_url);

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden bg-white/6",
        compact
          ? "h-14 w-14 rounded-xl border border-white/8"
          : "aspect-square w-full",
      )}
    >
      {coverUrl ? (
        <img
          src={coverUrl}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <span className="text-xl font-black text-slate-600">
          {itemTitle(item).slice(0, 2).toUpperCase()}
        </span>
      )}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-black/16 p-6 text-sm text-slate-500">
      {label}
    </div>
  );
}

function itemTitle(item: BandcampItem) {
  return (
    item.album_title || item.track_title || item.artist_name || "Bandcamp item"
  );
}
