import { taskRevalidationIssueCount } from "./task-insights";

export interface TaskResultLike {
  type: string;
  status: string;
  error: string | null;
  result: Record<string, unknown> | null;
}

type ResultDescription = (
  result: Record<string, unknown>,
) => string | undefined;

function describeNewContent(
  result: Record<string, unknown>,
): string | undefined {
  const steps = result.steps as Record<string, unknown> | undefined;
  if (!steps) return undefined;

  const values = Object.values(steps);
  const done = values.filter(
    (value) => value !== "failed" && value !== false,
  ).length;
  const failed = values.filter((value) => value === "failed").length;
  return `${done} steps done${failed ? `, ${failed} failed` : ""}`;
}

function describeEnrichmentBatch(result: Record<string, unknown>): string {
  const parts: string[] = [];
  if (result.enriched) parts.push(`${result.enriched} enriched`);
  if (result.skipped) parts.push(`${result.skipped} skipped`);
  if (result.failed) parts.push(`${result.failed} failed`);
  return parts.join(", ") || "Done";
}

function describeAnalysis(
  result: Record<string, unknown>,
  action: string,
): string {
  return `${result.analyzed ?? 0} ${action}${
    result.failed ? `, ${result.failed} failed` : ""
  }`;
}

function describePopularity(result: Record<string, unknown>): string {
  const parts: string[] = [];
  if (result.albums) parts.push(`${result.albums} albums`);
  if (result.tracks) parts.push(`${result.tracks} tracks`);
  return parts.join(", ") || "Done";
}

function describeRepair(result: Record<string, unknown>): string {
  const summary = (result.summary as Record<string, unknown> | undefined) ?? {};
  const applied = Number(summary.applied ?? 0);
  const skipped = Number(summary.skipped ?? 0);
  const failed = Number(summary.failed ?? 0);
  const manual = Number(summary.unsupported ?? 0);
  const remaining = taskRevalidationIssueCount(result);
  const parts = [`${applied} applied`];
  if (skipped) parts.push(`${skipped} skipped`);
  if (failed) parts.push(`${failed} failed`);
  if (manual) parts.push(`${manual} manual`);
  if (remaining != null) parts.push(`${remaining} open after revalidation`);
  return `${parts.join(", ")}${
    result.fs_changed ? " (filesystem modified)" : ""
  }`;
}

function describeArtistFix(result: Record<string, unknown>): string {
  const albumsFixed = Number(result.albums_fixed ?? 0);
  const syncedTracks = Number(result.synced_tracks ?? 0);
  return `${albumsFixed} albums fixed, ${syncedTracks} tracks synced`;
}

function describeLibrarySync(result: Record<string, unknown>): string {
  const parts: string[] = [];
  if (result.artists_added) parts.push(`+${result.artists_added} artists`);
  if (result.tracks_total) parts.push(`${result.tracks_total} tracks`);
  return parts.join(", ") || "Synced";
}

const RESULT_DESCRIBERS: Record<string, ResultDescription> = {
  process_new_content: describeNewContent,
  enrich_artist: (result) =>
    result.skipped ? "Skipped (recently enriched)" : "Artist enriched",
  enrich_artists: describeEnrichmentBatch,
  enrich_mbids: describeEnrichmentBatch,
  analyze_tracks: (result) => describeAnalysis(result, "tracks analyzed"),
  analyze_all: (result) => describeAnalysis(result, "tracks analyzed"),
  compute_bliss: (result) => describeAnalysis(result, "tracks vectorized"),
  compute_popularity: describePopularity,
  health_check: (result) => `${result.issue_count ?? 0} issues found`,
  repair: describeRepair,
  fix_artist: describeArtistFix,
  library_sync: describeLibrarySync,
  library_pipeline: describeLibrarySync,
  match_apply: (result) =>
    `${result.updated ?? 0}/${result.total ?? "?"} tracks tagged`,
  delete_artist: () => "Deleted",
  delete_album: () => "Deleted",
  compute_analytics: () => "Analytics computed",
  tidal_download: (result) =>
    result.error ? String(result.error) : "Downloaded",
};

function describeUnknownResult(result: Record<string, unknown>): string {
  const keys = Object.keys(result);
  if (keys.length === 0) return "Done";
  if (keys.length <= 3) {
    return keys
      .map((key) => `${key}: ${JSON.stringify(result[key])}`)
      .join(", ");
  }
  return `${keys.length} fields`;
}

export function describeTaskResult(task: TaskResultLike): string {
  if (task.error) {
    return task.error.length > 120
      ? `${task.error.slice(0, 120)}…`
      : task.error;
  }

  const result = task.result;
  if (!result) return task.status === "completed" ? "Completed" : "";

  const description = RESULT_DESCRIBERS[task.type]?.(result);
  return description ?? describeUnknownResult(result);
}
