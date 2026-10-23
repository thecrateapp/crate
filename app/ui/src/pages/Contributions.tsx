import { PageHeaderAction } from "@/components/layout/PageHeader";
import { OpsPageHero } from "@/components/admin/ops-surfaces";
import { RefreshCw as HeaderRefreshCw, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Card } from "@crate/ui/shadcn/card";
import { Avatar } from "@crate/ui/primitives/Avatar";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { StatusDot, type StatusDotTone } from "@crate/ui/primitives/StatusDot";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";

import { albumCoverApiUrl, albumPagePath } from "@/lib/library-routes";
import { api } from "@/lib/api";
import { formatDuration, timeAgo } from "@/lib/utils";

interface Contribution {
  id: number;
  user_id: number;
  user_email?: string | null;
  user_username?: string | null;
  user_name?: string | null;
  user_avatar?: string | null;
  source: string;
  source_ref: string;
  album_id?: number | null;
  album_entity_uid?: string | null;
  album_slug?: string | null;
  artist_name: string;
  album_name: string;
  status: string;
  imported_at?: string | null;
  withdrawn_at?: string | null;
  has_cover?: boolean | null;
  track_count?: number | null;
  total_duration?: number | null;
}

interface ContributionResponse {
  items: Contribution[];
  count: number;
}

function contributorName(item: Contribution) {
  return (
    item.user_name || item.user_username || item.user_email || "Unknown user"
  );
}

function contributionSourceLabel(source: string) {
  if (source === "bandcamp") return "Bandcamp";
  if (source === "listen_upload") return "Upload";
  if (source === "admin_upload") return "Admin upload";
  return source.replace(/_/g, " ") || "Library";
}

function contributionStatus(status: string): {
  label: string;
  tone: StatusDotTone;
} {
  const normalized = status.trim().toLowerCase();
  if (["pending", "importing", "processing"].includes(normalized)) {
    return { label: status || "Unknown", tone: "warn" };
  }
  if (["failed", "error"].includes(normalized)) {
    return { label: status || "Unknown", tone: "warn" };
  }
  if (["imported", "merged", "active", "approved"].includes(normalized)) {
    return { label: status || "Unknown", tone: "on" };
  }
  return { label: status || "Unknown", tone: "off" };
}

export function Contributions() {
  const [items, setItems] = useState<Contribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      const payload = await api<ContributionResponse>(
        "/api/manage/contributions?limit=150",
      );
      const nextItems = payload.items ?? [];
      setItems(nextItems);
      setCount(payload.items ? (payload.count ?? nextItems.length) : null);
    } catch (error) {
      setLoadError(true);
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Failed to load contributions",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-6">
      <OpsPageHero
        title="Contributions"
        description="Review what users brought into the shared library and who owns each import."
        compactActions
        actions={
          <PageHeaderAction
            label="Refresh"
            type="button"
            disabled={loading}
            aria-busy={loading}
            onClick={() => void load()}
          >
            {loading ? (
              <Loader2
                data-admin-ux="contributions-refresh-loading"
                aria-hidden="true"
                size={16}
                className="animate-spin"
              />
            ) : null}
            {!loading ? (
              <HeaderRefreshCw
                data-admin-ux="header-refresh"
                aria-hidden="true"
              />
            ) : null}
          </PageHeaderAction>
        }
      >
        {count != null ? (
          <InfoBadge active>{count.toLocaleString()} contributions</InfoBadge>
        ) : null}
      </OpsPageHero>

      <Card
        aria-busy={loading}
        className="overflow-hidden border-border-quiet bg-card"
      >
        {loading && items.length === 0 ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2
              data-admin-ux="contributions-list-loading"
              aria-hidden="true"
              size={16}
              className="animate-spin"
            />
            Loading contributions...
          </div>
        ) : items.length === 0 && loadError ? (
          <div className="grid gap-2 p-6" role="alert">
            <MonoLabel tone="accent">Contributions unavailable</MonoLabel>
            <p className="m-0 text-sm text-muted-foreground">
              The contribution list could not be loaded. Try again.
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-foreground">
              No contributions yet
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Bandcamp syncs and uploads will appear here for curator review.
            </p>
          </div>
        ) : (
          <>
            {loadError ? (
              <div
                className="border-b border-border-quiet px-4 py-3"
                role="status"
              >
                <StatusDot
                  tone="warn"
                  label="Refresh failed · showing last results"
                />
              </div>
            ) : null}
            <HairlineList
              as="ul"
              label="Community library contributions"
              ruled={false}
            >
              {items.map((item) => {
                const albumPath = item.album_id
                  ? albumPagePath({
                      albumId: item.album_id,
                      albumEntityUid: item.album_entity_uid,
                      albumSlug: item.album_slug,
                      artistName: item.artist_name,
                      albumName: item.album_name,
                    })
                  : "";
                const coverUrl =
                  item.album_id && item.has_cover
                    ? albumCoverApiUrl({
                        albumId: item.album_id,
                        albumEntityUid: item.album_entity_uid,
                        albumSlug: item.album_slug,
                        artistName: item.artist_name,
                        albumName: item.album_name,
                      })
                    : null;
                const displayName = contributorName(item);
                const status = contributionStatus(item.status);
                const sourceLabel = contributionSourceLabel(item.source);
                const rowMetadata = [
                  item.track_count ? `${item.track_count} tracks` : undefined,
                  item.total_duration
                    ? formatDuration(item.total_duration)
                    : undefined,
                ].filter((value): value is string => Boolean(value));
                const activityAt = item.withdrawn_at ?? item.imported_at;

                return (
                  <HairlineRow
                    key={item.id}
                    truncate={false}
                    className="items-stretch px-4 py-3.5"
                  >
                    <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1.45fr)_minmax(12rem,0.85fr)_minmax(13rem,1fr)] md:items-center md:gap-5">
                      <div className="flex min-w-0 items-center gap-3">
                        <MediaCover
                          src={coverUrl}
                          alt={item.album_name}
                          className="size-14 shrink-0 rounded-lg border border-border-quiet bg-muted"
                        />
                        <div className="min-w-0">
                          {albumPath ? (
                            <Link
                              to={albumPath}
                              className="inline-flex min-h-11 min-w-[44px] max-w-full items-center text-sm font-semibold text-foreground transition-colors hover:text-accent-action-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-action-hi"
                            >
                              <span className="truncate">
                                {item.album_name}
                              </span>
                            </Link>
                          ) : (
                            <p className="m-0 truncate py-2.5 text-sm font-semibold text-foreground">
                              {item.album_name}
                            </p>
                          )}
                          <p className="m-0 truncate text-sm text-muted-foreground">
                            {item.artist_name}
                          </p>
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                            <MonoLabel
                              as="span"
                              tone={
                                item.source === "bandcamp" ? "accent" : "subtle"
                              }
                            >
                              {sourceLabel}
                            </MonoLabel>
                            {rowMetadata.length > 0 ? (
                              <MonoLabel as="span" meta={rowMetadata} />
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="flex min-w-0 items-center gap-3 pl-[4.25rem] md:pl-0">
                        <Avatar
                          src={item.user_avatar}
                          name={displayName}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <p className="m-0 truncate text-sm font-medium text-foreground">
                            {displayName}
                          </p>
                          {item.user_username &&
                          item.user_username !== displayName ? (
                            <p className="m-0 truncate font-mono text-label text-text-subtle">
                              @{item.user_username}
                            </p>
                          ) : item.user_email &&
                            item.user_email !== displayName ? (
                            <p className="m-0 truncate text-xs text-muted-foreground">
                              {item.user_email}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid min-w-0 gap-1 pl-[4.25rem] md:justify-items-end md:pl-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 md:justify-end">
                          <StatusDot tone={status.tone} label={status.label} />
                          <MonoLabel as="span">
                            {activityAt ? timeAgo(activityAt) : "Unknown time"}
                          </MonoLabel>
                        </div>
                        <MonoLabel
                          as="span"
                          aria-label={`Source reference: ${item.source_ref}`}
                          className="max-w-full truncate font-mono normal-case tracking-normal"
                        >
                          {item.source_ref}
                        </MonoLabel>
                      </div>
                    </div>
                  </HairlineRow>
                );
              })}
            </HairlineList>
          </>
        )}
      </Card>
    </div>
  );
}
