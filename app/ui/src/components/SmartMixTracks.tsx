import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { CrateChip } from "@crate/ui/primitives/CrateBadge";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@crate/ui/shadcn/table";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export type SmartMixTrackFilter =
  | "all"
  | "current"
  | "outdated"
  | "source_changed"
  | "unavailable"
  | "missing"
  | "failed";

export interface SmartMixVersionCount {
  analyzerVersion: string;
  profiles: number;
  current: boolean;
}

export interface SmartMixTrackCounts {
  totalTracks: number;
  currentProfiles: number;
  outdatedProfiles?: number;
  sourceChangedProfiles?: number;
  quality: { unavailable: number };
  versions?: SmartMixVersionCount[];
}

interface SmartMixTrack {
  trackId: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  status: Exclude<SmartMixTrackFilter, "all" | "failed">;
  analyzerVersion: string | null;
  quality: string | null;
  bpm: number | null;
  introBpm: number | null;
  outroBpm: number | null;
  analyzedAt: string | null;
  processingState: string | null;
  processingError: string | null;
}

interface SmartMixTrackPage {
  tracks: SmartMixTrack[];
  nextBefore: number | null;
}

const MIN_SEARCH_LENGTH = 3;
const SEARCH_DEBOUNCE_MS = 300;

const STATUS_LABELS: Record<SmartMixTrack["status"], string> = {
  current: "Current",
  outdated: "Outdated",
  source_changed: "File changed",
  unavailable: "Unavailable",
  missing: "No profile",
};

const FILTERS: { key: SmartMixTrackFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "current", label: "Current" },
  { key: "outdated", label: "Outdated" },
  { key: "source_changed", label: "File changed" },
  { key: "unavailable", label: "Unavailable" },
  { key: "missing", label: "No profile" },
  { key: "failed", label: "Failed" },
];

function filterCounts(
  counts: SmartMixTrackCounts,
): Record<SmartMixTrackFilter, number | null> {
  const outdated = counts.outdatedProfiles ?? 0;
  const sourceChanged = counts.sourceChangedProfiles ?? 0;
  const unavailable = counts.quality.unavailable;
  return {
    all: counts.totalTracks,
    current: counts.currentProfiles,
    outdated,
    source_changed: sourceChanged,
    unavailable,
    missing: Math.max(
      counts.totalTracks -
        counts.currentProfiles -
        outdated -
        sourceChanged -
        unavailable,
      0,
    ),
    failed: null,
  };
}

function tracksUrl(
  filter: SmartMixTrackFilter,
  version: string | null,
  search: string,
  before?: number,
) {
  const params = new URLSearchParams({ status: filter });
  if (version) params.set("version", version);
  if (search) params.set("q", search);
  if (before != null) params.set("before", String(before));
  return `/api/admin/smart-mix/tracks?${params.toString()}`;
}

function formatBpm(value: number | null) {
  return value == null ? null : value.toFixed(1);
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export function SmartMixTracks({ counts }: { counts: SmartMixTrackCounts }) {
  const [filter, setFilter] = useState<SmartMixTrackFilter>("all");
  const [version, setVersion] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [more, setMore] = useState<{
    url: string;
    tracks: SmartMixTrack[];
    nextBefore: number | null;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [queued, setQueued] = useState<Set<number>>(() => new Set());
  const [reanalyzing, setReanalyzing] = useState<number | null>(null);

  useEffect(() => {
    const trimmed = searchInput.trim();
    const timer = setTimeout(
      () => setSearch(trimmed.length >= MIN_SEARCH_LENGTH ? trimmed : ""),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [searchInput]);

  const url = tracksUrl(filter, version, search);
  const { data, loading, error } = useApi<SmartMixTrackPage>(url);
  const extra = more?.url === url ? more : null;
  const tracks = [...(data?.tracks ?? []), ...(extra?.tracks ?? [])];
  const nextBefore = extra ? extra.nextBefore : data?.nextBefore ?? null;
  const countsByFilter = filterCounts(counts);

  async function loadMore() {
    if (nextBefore == null) return;
    setLoadingMore(true);
    try {
      const page = await api<SmartMixTrackPage>(
        tracksUrl(filter, version, search, nextBefore),
      );
      setMore({
        url,
        tracks: [...(extra?.tracks ?? []), ...page.tracks],
        nextBefore: page.nextBefore,
      });
    } catch {
      toast.error("Could not load more Smart Mix tracks");
    } finally {
      setLoadingMore(false);
    }
  }

  async function reanalyze(track: SmartMixTrack) {
    setReanalyzing(track.trackId);
    try {
      const result = await api<{ status: "queued" | "already_queued" }>(
        `/api/admin/smart-mix/tracks/${track.trackId}/reanalyze`,
        "POST",
      );
      setQueued((current) => new Set(current).add(track.trackId));
      toast.success(
        result.status === "queued"
          ? "Smart Mix reanalysis queued"
          : "Smart Mix reanalysis is already queued",
      );
    } catch {
      toast.error("Could not queue the Smart Mix reanalysis");
    } finally {
      setReanalyzing(null);
    }
  }

  return (
    <div className="space-y-3">
      {counts.versions && counts.versions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.12em] text-white/30">
            Versions
          </span>
          {counts.versions.map((entry) => (
            <button
              key={entry.analyzerVersion}
              type="button"
              aria-pressed={version === entry.analyzerVersion}
              onClick={() =>
                setVersion((current) =>
                  current === entry.analyzerVersion
                    ? null
                    : entry.analyzerVersion,
                )
              }
            >
              <CrateChip
                className={cn(
                  "text-[10px]",
                  version === entry.analyzerVersion && "border-primary/60",
                  !entry.current && "text-amber-200",
                )}
              >
                {entry.analyzerVersion} · {entry.profiles.toLocaleString()}
                {entry.current ? " · current" : ""}
              </CrateChip>
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1" role="tablist">
          {FILTERS.map((item) => (
            <Button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={filter === item.key}
              size="sm"
              variant={filter === item.key ? "default" : "outline"}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
              {countsByFilter[item.key] != null
                ? ` · ${countsByFilter[item.key]?.toLocaleString()}`
                : ""}
            </Button>
          ))}
        </div>
        <div className="relative lg:w-72">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-white/35"
          />
          <Input
            aria-label="Search tracks"
            placeholder="Search title, artist or album"
            className="pl-8"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-500/20 bg-red-500/8 p-4 text-sm text-red-100">
          Smart Mix tracks are unavailable.
        </div>
      ) : loading && !data ? (
        <div className="flex min-h-24 items-center justify-center text-white/45">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : tracks.length === 0 ? (
        <div className="rounded-md border border-white/6 bg-black/20 p-4 text-sm text-white/45">
          No tracks match these filters.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Track</TableHead>
              <TableHead>Profile</TableHead>
              <TableHead>BPM</TableHead>
              <TableHead>Analyzed</TableHead>
              <TableHead>Pipeline</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tracks.map((track) => (
              <TableRow key={track.trackId}>
                <TableCell>
                  <div className="text-sm text-white/85">
                    {track.title || "Untitled"}
                  </div>
                  <div className="text-xs text-white/40">
                    {track.artist || "Unknown artist"}
                    {track.album ? ` · ${track.album}` : ""}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    <CrateChip
                      className={cn(
                        "text-[10px]",
                        track.status !== "current" && "text-amber-200",
                      )}
                    >
                      {STATUS_LABELS[track.status]}
                    </CrateChip>
                    {track.analyzerVersion ? (
                      <CrateChip className="text-[10px]">
                        {track.analyzerVersion}
                      </CrateChip>
                    ) : null}
                    {track.quality ? (
                      <CrateChip className="text-[10px]">
                        {track.quality}
                      </CrateChip>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-white/70">
                  {formatBpm(track.bpm) ?? "-"}
                  {track.introBpm != null && track.outroBpm != null ? (
                    <div className="text-white/40">
                      {formatBpm(track.introBpm)} to {formatBpm(track.outroBpm)}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="text-xs text-white/55">
                  {formatDate(track.analyzedAt)}
                </TableCell>
                <TableCell className="text-xs text-white/55">
                  <span title={track.processingError ?? undefined}>
                    {track.processingState ?? "-"}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    disabled={
                      reanalyzing === track.trackId || queued.has(track.trackId)
                    }
                    onClick={() => void reanalyze(track)}
                  >
                    {reanalyzing === track.trackId ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    {queued.has(track.trackId) ? "Queued" : "Reanalyze track"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {nextBefore != null && tracks.length > 0 ? (
        <div className="flex justify-center">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-2"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? (
              <Loader2 size={14} className="animate-spin" />
            ) : null}
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
