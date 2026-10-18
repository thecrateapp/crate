import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@crate/ui/shadcn/button";
import { Card } from "@crate/ui/shadcn/card";
import { Badge } from "@crate/ui/shadcn/badge";

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

export function Contributions() {
  const [items, setItems] = useState<Contribution[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const payload = await api<ContributionResponse>(
        "/api/manage/contributions?limit=150",
      );
      setItems(payload.items ?? []);
    } catch (error) {
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
      <section className="border-b border-border-quiet pb-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold text-foreground">
              Contributions
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Review what users brought into the shared library and who owns
              each import.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={loading}
            aria-busy={loading}
            onClick={() => void load()}
          >
            {loading ? (
              <Loader2
                data-admin-ux="contributions-refresh-loading"
                aria-hidden="true"
                size={16}
                className="mr-2 animate-spin"
              />
            ) : null}
            Refresh
          </Button>
        </div>
      </section>

      <Card className="border-border-quiet bg-card">
        {loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2
              data-admin-ux="contributions-list-loading"
              aria-hidden="true"
              size={16}
              className="animate-spin"
            />
            Loading contributions...
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
          <div className="divide-y divide-border-quiet">
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
                  : "";
              return (
                <div
                  key={item.id}
                  className="flex flex-col gap-4 px-5 py-4 xl:flex-row xl:items-center xl:justify-between"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border-quiet bg-muted">
                      {coverUrl ? (
                        <img
                          src={coverUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      {albumPath ? (
                        <Link
                          to={albumPath}
                          className="inline-flex min-h-11 min-w-11 max-w-full items-center text-sm font-semibold text-foreground hover:text-accent-action-hi"
                        >
                          <span className="truncate">{item.album_name}</span>
                        </Link>
                      ) : (
                        <div className="truncate text-sm font-semibold text-foreground">
                          {item.album_name}
                        </div>
                      )}
                      <div className="truncate text-xs text-muted-foreground">
                        {item.artist_name}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge variant="secondary">
                          {contributionSourceLabel(item.source)}
                        </Badge>
                        <Badge variant="outline">{item.status}</Badge>
                        {item.track_count ? (
                          <Badge variant="outline">
                            {item.track_count} tracks
                          </Badge>
                        ) : null}
                        {item.total_duration ? (
                          <Badge variant="outline">
                            {formatDuration(item.total_duration)}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="w-full min-w-0 text-left xl:w-auto xl:max-w-xs xl:text-right">
                    <div className="break-words text-sm font-medium text-foreground">
                      {contributorName(item)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {item.imported_at ? timeAgo(item.imported_at) : "unknown"}
                    </div>
                    <div className="mt-1 max-w-full truncate font-mono text-label text-text-muted">
                      {item.source_ref}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
