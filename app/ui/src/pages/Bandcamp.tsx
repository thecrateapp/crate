import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import {
  PageHeaderAction,
  PageHeaderActions,
} from "@/components/layout/PageHeader";
import {
  RefreshCw as HeaderFolderSync,
  Radar as HeaderRadar,
  Link as HeaderLink,
  Loader2,
} from "@crate/ui/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import {
  OpsPageHero,
  OpsPanel,
  OpsStatTile,
  OpsSurface,
} from "@/components/admin/ops-surfaces";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Button } from "@crate/ui/shadcn/button";
import { Badge } from "@crate/ui/shadcn/badge";

import { api } from "@/lib/api";
import { waitForTask } from "@/lib/tasks";
import { useApi } from "@/hooks/use-api";
import { cn } from "@/lib/utils";

interface BandcampConnectionStatus {
  connected: boolean;
  status: string;
  bridge_enabled: boolean;
  username?: string | null;
  fan_id?: number | null;
  display_name?: string | null;
  image_url?: string | null;
  connection_method?: string | null;
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

interface BandcampImportResponse {
  imports: BandcampImport[];
  total: number;
}

interface BandcampMatchesResponse {
  items: BandcampMatch[];
  total: number;
}

interface BandcampItem {
  id: number;
  bandcamp_item_id?: number | null;
  bandcamp_item_type?: string | null;
  artist_name?: string | null;
  album_title?: string | null;
  track_title?: string | null;
  item_url?: string | null;
  cover_url?: string | null;
  owned?: boolean | null;
  downloadable?: boolean | null;
  latest_import_status?: string | null;
  user_email?: string | null;
  user_username?: string | null;
  user_name?: string | null;
}

interface BandcampRadarItem extends BandcampItem {
  score?: number | null;
  source?: string | null;
  status?: string | null;
}

interface BandcampImport extends BandcampItem {
  status?: string | null;
  requested_format?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
}

interface BandcampMatch extends BandcampItem {
  id: number;
  entity_type: "artist" | "album" | "track";
  entity_uid: string;
  entity_name?: string | null;
  entity_artist?: string | null;
  confidence: number;
  status: "candidate" | "confirmed" | "rejected";
  source?: string | null;
}

export function Bandcamp() {
  const status = useApi<BandcampConnectionStatus>("/api/bandcamp/me/status");
  const collection = useApi<BandcampCollectionResponse>(
    "/api/bandcamp/me/collection",
  );
  const wishlist = useApi<BandcampCollectionResponse>(
    "/api/bandcamp/me/wishlist",
  );
  const following = useApi<BandcampCollectionResponse>(
    "/api/bandcamp/me/following",
  );
  const radar = useApi<BandcampRadarResponse>("/api/bandcamp/me/radar");
  const imports = useApi<BandcampImportResponse>("/api/bandcamp/me/imports");
  const adminCollection = useApi<BandcampCollectionResponse>(
    "/api/bandcamp/admin/collection?relation_type=collection&limit=50",
  );
  const matches = useApi<BandcampMatchesResponse>(
    "/api/bandcamp/admin/matches?limit=100",
  );
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const taskWait = useRef<AbortController | null>(null);
  useEffect(() => () => taskWait.current?.abort(), []);

  const refreshAll = useCallback(() => {
    status.refetch();
    collection.refetch();
    wishlist.refetch();
    following.refetch();
    radar.refetch();
    imports.refetch();
    adminCollection.refetch();
    matches.refetch();
  }, [
    adminCollection,
    collection,
    following,
    imports,
    matches,
    radar,
    status,
    wishlist,
  ]);

  const counts = [
    { label: "Collection", source: collection },
    { label: "Wishlist", source: wishlist },
    { label: "Following", source: following },
    { label: "Radar", source: radar },
  ].map(({ label, source }) => ({
    label,
    value:
      source.data && !source.loading && !source.error
        ? source.data.total
        : null,
  }));

  async function queueTask(path: string, label: string) {
    const controller = new AbortController();
    taskWait.current = controller;
    setBusyAction(label);
    let queued = false;
    try {
      const { task_id } = await api<{ task_id: string }>(path, "POST");
      if (!task_id) throw new Error(`${label} returned no task identifier`);
      queued = true;
      toast.success(`${label} queued`);
      const task = await waitForTask(task_id, 300000, controller.signal);
      if (task.status !== "completed")
        throw new Error(task.error || `${label} ${task.status}`);
      refreshAll();
      toast.success(`${label} completed`);
    } catch (error) {
      if (!controller.signal.aborted)
        toast.error(
          (error as Error).message ||
            `Failed to ${queued ? "complete" : "queue"} ${label}`,
        );
    } finally {
      if (!controller.signal.aborted) setBusyAction(null);
    }
  }

  async function updateMatch(matchId: number, action: "confirm" | "reject") {
    const label = `${action}:${matchId}`;
    setBusyAction(label);
    try {
      await api(`/api/bandcamp/admin/matches/${matchId}/${action}`, "POST");
      toast.success(
        action === "confirm" ? "Match confirmed" : "Match rejected",
      );
      matches.refetch();
    } catch (error) {
      toast.error(
        (error as Error).message || "Failed to update Bandcamp match",
      );
    } finally {
      setBusyAction(null);
    }
  }

  const connected = status.data?.connected === true;
  const latestImports = imports.data?.imports.slice(0, 5) ?? [];
  const latestRadar = radar.data?.items.slice(0, 5) ?? [];
  const syncedPurchases = adminCollection.data?.items.slice(0, 8) ?? [];
  const candidateMatches =
    matches.data?.items.filter((match) => match.status === "candidate") ?? [];
  const confirmedMatches =
    matches.data?.items
      .filter((match) => match.status === "confirmed")
      .slice(0, 8) ?? [];

  return (
    <main className="space-y-8">
      <OpsPageHero
        title="Bandcamp"
        description="Connect purchases, match Bandcamp URLs to Crate entities and import owned releases without making the library messy."
        compactActions
        actions={
          <PageHeaderActions>
            <>
              {" "}
              <PageHeaderAction
                label="Sync collection"
                onClick={() =>
                  queueTask("/api/bandcamp/me/sync", "Bandcamp sync")
                }
                aria-busy={busyAction === "Bandcamp sync"}
                disabled={!connected || busyAction !== null}
              >
                {busyAction === "Bandcamp sync" && (
                  <Loader2
                    data-admin-ux="bandcamp-sync-loading"
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin"
                  />
                )}
                {!(busyAction === "Bandcamp sync") ? (
                  <HeaderFolderSync
                    data-admin-ux="header-sync-collection"
                    aria-hidden="true"
                  />
                ) : null}
              </PageHeaderAction>
              <PageHeaderAction
                label="Refresh Radar"
                onClick={() =>
                  queueTask("/api/bandcamp/me/radar/refresh", "Bandcamp Radar")
                }
                aria-busy={busyAction === "Bandcamp Radar"}
                disabled={!connected || busyAction !== null}
              >
                <HeaderRadar
                  data-admin-ux="header-refresh-radar"
                  aria-hidden="true"
                />
              </PageHeaderAction>
              <PageHeaderAction
                label="Backfill URLs"
                onClick={() =>
                  queueTask(
                    "/api/bandcamp/admin/backfill-urls?limit=250&public_search=true",
                    "Bandcamp URL backfill",
                  )
                }
                aria-busy={busyAction === "Bandcamp URL backfill"}
                disabled={busyAction !== null}
              >
                {busyAction === "Bandcamp URL backfill" && (
                  <Loader2
                    data-admin-ux="bandcamp-backfill-loading"
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin"
                  />
                )}
                {!(busyAction === "Bandcamp URL backfill") ? (
                  <HeaderLink
                    data-admin-ux="header-backfill-urls"
                    aria-hidden="true"
                  />
                ) : null}
              </PageHeaderAction>
            </>
          </PageHeaderActions>
        }
      >
        <InfoBadge>Bandcamp bridge</InfoBadge>
        <ConnectionStatus
          status={status.data}
          loading={status.loading}
          error={status.error}
          onRetry={() => void status.refetch()}
        />
      </OpsPageHero>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {counts.map((count) => (
          <OpsStatTile
            key={count.label}
            label={count.label}
            value={count.value?.toLocaleString() ?? "—"}
          />
        ))}
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.8fr)]">
        <Panel
          title="Match candidates"
          eyebrow={
            matches.data && !matches.error
              ? `${candidateMatches.length} pending`
              : "Not available"
          }
        >
          <ReadState source={matches} label="Bandcamp matches">
            {candidateMatches.length ? (
              <div className="space-y-3">
                {candidateMatches.map((match) => (
                  <MatchRow
                    key={match.id}
                    match={match}
                    busyAction={busyAction}
                    onConfirm={() => updateMatch(match.id, "confirm")}
                    onReject={() => updateMatch(match.id, "reject")}
                  />
                ))}
              </div>
            ) : (
              <EmptyState description="No Bandcamp match candidates pending." />
            )}
          </ReadState>
        </Panel>

        <div className="space-y-6">
          <Panel
            title="Radar"
            eyebrow={
              radar.data && !radar.error
                ? `${latestRadar.length} visible`
                : "Not available"
            }
          >
            <ReadState source={radar} label="Bandcamp Radar">
              <CompactItemList
                items={latestRadar}
                empty="No Radar candidates yet."
              />
            </ReadState>
          </Panel>
          <Panel
            title="Recent imports"
            eyebrow={
              imports.data && !imports.error
                ? `${imports.data.total} total`
                : "Not available"
            }
          >
            <ReadState source={imports} label="Bandcamp imports">
              <CompactImportList imports={latestImports} />
            </ReadState>
          </Panel>
          <Panel
            title="Synced purchases"
            eyebrow={
              adminCollection.data && !adminCollection.error
                ? `${adminCollection.data.total} across users`
                : "Not available"
            }
          >
            <ReadState source={adminCollection} label="Bandcamp purchases">
              <AdminCollectionList items={syncedPurchases} />
            </ReadState>
          </Panel>
        </div>
      </section>

      <Panel
        title="Confirmed links"
        eyebrow={
          matches.data && !matches.error
            ? `${confirmedMatches.length} recent`
            : "Not available"
        }
      >
        <ReadState source={matches} label="Confirmed Bandcamp links">
          {confirmedMatches.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {confirmedMatches.map((match) => (
                <ConfirmedMatchCard key={match.id} match={match} />
              ))}
            </div>
          ) : (
            <EmptyState description="Confirmed Bandcamp links will appear here." />
          )}
        </ReadState>
      </Panel>
    </main>
  );
}

function ConnectionStatus({
  status,
  loading,
  error,
  onRetry,
}: {
  status: BandcampConnectionStatus | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (error)
    return (
      <ErrorState
        message="Bandcamp connection could not be loaded."
        onRetry={onRetry}
      />
    );
  if (loading && !status) {
    return <InfoBadge>Checking connection...</InfoBadge>;
  }
  if (!status) return <InfoBadge>Connection unavailable</InfoBadge>;
  if (!status.connected) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <InfoBadge tone="neutral">Not connected</InfoBadge>
        <span className="text-sm text-text-muted">
          Connect from Listen Settings before syncing purchases.
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <InfoBadge tone="success">Connected</InfoBadge>
      <span className="text-sm text-text-secondary">
        {status.display_name || status.username || "Bandcamp fan"}
      </span>
      {status.connection_method ? (
        <MonoLabel as="span">{status.connection_method}</MonoLabel>
      ) : null}
    </div>
  );
}

function Panel({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <OpsPanel
      title={title}
      action={
        <MonoLabel as="span" className="text-accent-action-hi">
          {eyebrow}
        </MonoLabel>
      }
    >
      {children}
    </OpsPanel>
  );
}

function MatchRow({
  match,
  busyAction,
  onConfirm,
  onReject,
}: {
  match: BandcampMatch;
  busyAction: string | null;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const title = itemTitle(match);
  const subtitle = [match.artist_name, match.album_title || match.track_title]
    .filter(Boolean)
    .join(" · ");
  const entity = [match.entity_artist, match.entity_name]
    .filter(Boolean)
    .join(" · ");
  return (
    <OpsSurface
      as="article"
      className="grid gap-4 p-4 md:grid-cols-[56px_minmax(0,1fr)_auto] md:items-center"
    >
      <ItemCover item={match} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{match.entity_type}</Badge>
          <Badge className="bg-accent-action/10 text-accent-action-hi">
            {Math.round((match.confidence || 0) * 100)}%
          </Badge>
          <MonoLabel as="span">{match.source || "sync"}</MonoLabel>
        </div>
        <h3 className="mt-2 truncate text-base font-bold text-text-primary font-display">
          {entity}
        </h3>
        <p className="m-0 truncate text-sm text-text-muted">{title}</p>
        {subtitle ? (
          <p className="m-0 truncate text-xs text-text-subtle">{subtitle}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 md:justify-end">
        {match.item_url ? (
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={() =>
              window.open(match.item_url || "", "_blank", "noopener,noreferrer")
            }
          >
            Open
          </Button>
        ) : null}
        <Button
          size="sm"
          className="gap-2"
          aria-busy={busyAction === `confirm:${match.id}`}
          disabled={busyAction !== null}
          onClick={onConfirm}
        >
          {busyAction === `confirm:${match.id}` && (
            <Loader2
              data-admin-ux="bandcamp-confirm-loading"
              aria-hidden="true"
              className="h-4 w-4 animate-spin"
            />
          )}
          Confirm
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          aria-busy={busyAction === `reject:${match.id}`}
          disabled={busyAction !== null}
          onClick={onReject}
        >
          Reject
        </Button>
      </div>
    </OpsSurface>
  );
}

function ConfirmedMatchCard({ match }: { match: BandcampMatch }) {
  return (
    <button
      type="button"
      className="group min-h-11 min-w-0 rounded-md border border-border-quiet bg-raised-surface p-3 text-left transition hover:border-accent-action-hi/40 hover:bg-panel-surface"
      onClick={() =>
        match.item_url &&
        window.open(match.item_url, "_blank", "noopener,noreferrer")
      }
    >
      <ItemCover item={match} large />
      <div className="mt-3 min-w-0">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{match.entity_type}</Badge>
        </div>
        <h3 className="mt-2 truncate text-sm font-bold text-text-primary font-display">
          {match.entity_name || itemTitle(match)}
        </h3>
        <p className="m-0 truncate text-xs text-text-subtle">
          {itemTitle(match)}
        </p>
      </div>
    </button>
  );
}

function CompactItemList({
  items,
  empty,
}: {
  items: BandcampItem[];
  empty: string;
}) {
  if (!items.length) return <EmptyState description={empty} />;
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <button
          key={`${item.id}-${item.item_url}`}
          type="button"
          className="flex min-h-11 w-full items-center gap-3 rounded-md border border-border-quiet bg-raised-surface p-3 text-left transition hover:border-accent-action-hi/40 hover:bg-panel-surface"
          onClick={() =>
            item.item_url &&
            window.open(item.item_url, "_blank", "noopener,noreferrer")
          }
        >
          <ItemCover item={item} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-bold text-text-primary font-display">
              {itemTitle(item)}
            </h3>
            <p className="m-0 truncate text-xs text-text-subtle">
              {item.artist_name}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}

function CompactImportList({ imports }: { imports: BandcampImport[] }) {
  if (!imports.length)
    return <EmptyState description="No Bandcamp imports yet." />;
  return (
    <div className="space-y-3">
      {imports.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-3 rounded-md border border-border-quiet bg-raised-surface p-3"
        >
          <ItemCover item={item} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-bold text-text-primary font-display">
              {itemTitle(item)}
            </h3>
            <p className="m-0 truncate text-xs text-text-subtle">
              {item.requested_format || "flac"} · {item.status || "queued"}
            </p>
          </div>
          <Badge className={cn("capitalize", importStatusClass(item.status))}>
            {item.status || "queued"}
          </Badge>
        </div>
      ))}
    </div>
  );
}

function AdminCollectionList({ items }: { items: BandcampItem[] }) {
  if (!items.length) {
    return <EmptyState description="No Bandcamp purchases synced yet." />;
  }
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <button
          key={`${item.user_email}-${item.id}-${item.item_url}`}
          type="button"
          className="flex min-h-11 w-full items-center gap-3 rounded-md border border-border-quiet bg-raised-surface p-3 text-left transition hover:border-accent-action-hi/40 hover:bg-panel-surface"
          onClick={() =>
            item.item_url &&
            window.open(item.item_url, "_blank", "noopener,noreferrer")
          }
        >
          <ItemCover item={item} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-bold text-text-primary font-display">
              {itemTitle(item)}
            </h3>
            <p className="m-0 truncate text-xs text-text-subtle">
              {item.artist_name} ·{" "}
              {item.user_name || item.user_username || item.user_email}
            </p>
          </div>
          {item.latest_import_status ? (
            <Badge
              className={cn(
                "capitalize",
                importStatusClass(item.latest_import_status),
              )}
            >
              {item.latest_import_status}
            </Badge>
          ) : (
            <Badge variant="outline">synced</Badge>
          )}
        </button>
      ))}
    </div>
  );
}

function ItemCover({
  item,
  large = false,
}: {
  item: BandcampItem;
  large?: boolean;
}) {
  const title = itemTitle(item);
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border-quiet bg-panel-surface",
        large ? "aspect-square w-full" : "h-14 w-14",
      )}
    >
      {item.cover_url ? (
        <img
          src={item.cover_url}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <span className="px-2 text-center text-xs font-bold text-text-subtle">
          {title.slice(0, 2).toUpperCase()}
        </span>
      )}
    </div>
  );
}

function ReadState({
  source,
  label,
  children,
}: {
  source: {
    data: unknown;
    loading: boolean;
    error: unknown;
    refetch: () => unknown;
  };
  label: string;
  children: ReactNode;
}) {
  if (source.loading) return <LoadingState label={`Loading ${label}`} />;
  if (source.error || !source.data) {
    return (
      <ErrorState
        message={`${label} could not be loaded.`}
        onRetry={() => void source.refetch()}
      />
    );
  }
  return children;
}

function itemTitle(item: BandcampItem) {
  return (
    item.album_title || item.track_title || item.artist_name || "Bandcamp item"
  );
}

function importStatusClass(status?: string | null) {
  if (status === "completed")
    return "border-accent-action/25 bg-accent-action/10 text-accent-action";
  if (status === "failed")
    return "border-state-warning/25 bg-state-warning/10 text-state-warning-text";
  if (status === "running")
    return "border-accent-action-hi/40 bg-accent-action/10 text-accent-action-hi";
  return "border-border-quiet bg-transparent text-text-secondary";
}
