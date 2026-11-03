export type KpiAggregation = "sum" | "latest" | "mean";
export type KpiUnit = "count" | "hours" | "minutes" | "gib" | "ratio";
export type KpiGroupId =
  | "users"
  | "listening"
  | "library"
  | "acquisition"
  | "engagement"
  | "federation";

export interface KpiDefinition {
  kpi: string;
  label: string;
  group: KpiGroupId;
  aggregation: KpiAggregation;
  unit: KpiUnit;
  breakdown?: string;
  caption?: string;
  tile?: boolean;
}

export interface ProductKpiPoint {
  day: string;
  value: number | null;
  sample: number | null;
  suppressed: boolean;
}

export interface ProductKpiSeries {
  kpi: string;
  dims: Record<string, string>;
  points: ProductKpiPoint[];
}

export interface ProductKpiResponse {
  window_days: number;
  current_start: string;
  previous_start: string;
  end: string;
  computed_at: string | null;
  minimum_sample: number;
  series: ProductKpiSeries[];
}

export interface KpiReading {
  definition: KpiDefinition;
  value: number | null;
  previous: number | null;
  change: number | null;
  coveredDays: number;
}

export interface KpiBreakdownRow {
  label: string;
  value: number | null;
  share: number | null;
  hidden: boolean;
}

export const KPI_GROUPS: {
  id: KpiGroupId;
  title: string;
  description: string;
}[] = [
  {
    id: "users",
    title: "Users",
    description: "Accounts, reach and whether new listeners come back.",
  },
  {
    id: "listening",
    title: "Listening",
    description: "Plays, time listened and where listening happens.",
  },
  {
    id: "library",
    title: "Library",
    description: "Catalogue size, growth and how much of it gets played.",
  },
  {
    id: "acquisition",
    title: "Acquisition",
    description: "Downloads and imports finished per source.",
  },
  {
    id: "engagement",
    title: "Engagement",
    description: "Likes, follows, curation and scrobbling.",
  },
  {
    id: "federation",
    title: "Federation and streams",
    description: "Peers, remote streams, imports and delivered audio.",
  },
];

export const KPI_CATALOGUE: KpiDefinition[] = [
  {
    kpi: "users.total",
    label: "Accounts",
    group: "users",
    aggregation: "latest",
    unit: "count",
  },
  {
    kpi: "users.active",
    label: "Active accounts",
    group: "users",
    aggregation: "latest",
    unit: "count",
    caption: "Signed in, seen or listened within the inactivity window",
  },
  {
    kpi: "users.daily_listeners",
    label: "Daily listeners",
    group: "users",
    aggregation: "mean",
    unit: "count",
    caption: "Average per day",
  },
  {
    kpi: "users.weekly_listeners",
    label: "Weekly listeners",
    group: "users",
    aggregation: "latest",
    unit: "count",
  },
  {
    kpi: "users.monthly_listeners",
    label: "Monthly listeners",
    group: "users",
    aggregation: "latest",
    unit: "count",
  },
  {
    kpi: "users.signups",
    label: "Signups",
    group: "users",
    aggregation: "sum",
    unit: "count",
  },
  {
    kpi: "users.invites_accepted",
    label: "Invites accepted",
    group: "users",
    aggregation: "sum",
    unit: "count",
  },
  {
    kpi: "users.retention_w1",
    label: "Week 1 retention",
    group: "users",
    aggregation: "latest",
    unit: "ratio",
    caption: "Listened again in their second week",
  },
  {
    kpi: "users.retention_w4",
    label: "Week 4 retention",
    group: "users",
    aggregation: "latest",
    unit: "ratio",
    caption: "Listened again in their fifth week",
  },
  {
    kpi: "devices.active_by_platform",
    label: "Active devices",
    group: "users",
    aggregation: "latest",
    unit: "count",
    breakdown: "platform",
  },
  {
    kpi: "listening.plays",
    label: "Plays",
    group: "listening",
    aggregation: "sum",
    unit: "count",
  },
  {
    kpi: "listening.hours",
    label: "Hours listened",
    group: "listening",
    aggregation: "sum",
    unit: "hours",
  },
  {
    kpi: "listening.complete_plays",
    label: "Completed plays",
    group: "listening",
    aggregation: "sum",
    unit: "count",
  },
  {
    kpi: "listening.skips",
    label: "Skips",
    group: "listening",
    aggregation: "sum",
    unit: "count",
  },
  {
    kpi: "listening.sessions",
    label: "Sessions",
    group: "listening",
    aggregation: "sum",
    unit: "count",
  },
  {
    kpi: "listening.session_minutes_avg",
    label: "Session length",
    group: "listening",
    aggregation: "mean",
    unit: "minutes",
  },
  {
    kpi: "listening.unique_tracks",
    label: "Tracks played per day",
    group: "listening",
    aggregation: "mean",
    unit: "count",
  },
  {
    kpi: "listening.unique_artists",
    label: "Artists played per day",
    group: "listening",
    aggregation: "mean",
    unit: "count",
  },
  {
    kpi: "listening.plays_by_platform",
    label: "Plays by platform",
    group: "listening",
    aggregation: "sum",
    unit: "count",
    breakdown: "platform",
    tile: false,
  },
  {
    kpi: "listening.plays_by_source",
    label: "Plays by source",
    group: "listening",
    aggregation: "sum",
    unit: "count",
    breakdown: "source",
    tile: false,
  },
  {
    kpi: "listening.plays_by_origin",
    label: "Plays by origin",
    group: "listening",
    aggregation: "sum",
    unit: "count",
    breakdown: "origin",
    tile: false,
  },
  {
    kpi: "library.artists",
    label: "Artists",
    group: "library",
    aggregation: "latest",
    unit: "count",
  },
  {
    kpi: "library.albums",
    label: "Albums",
    group: "library",
    aggregation: "latest",
    unit: "count",
  },
  {
    kpi: "library.tracks",
    label: "Tracks",
    group: "library",
    aggregation: "latest",
    unit: "count",
  },
  {
    kpi: "library.size_gib",
    label: "Library size",
    group: "library",
    aggregation: "latest",
    unit: "gib",
  },
  {
    kpi: "library.new_artists",
    label: "New artists",
    group: "library",
    aggregation: "sum",
    unit: "count",
  },
  {
    kpi: "library.played_share_30d",
    label: "Catalogue played",
    group: "library",
    aggregation: "latest",
    unit: "ratio",
    caption: "Share of tracks played in the last 30 days",
  },
  {
    kpi: "acquisition.completed",
    label: "Completed",
    group: "acquisition",
    aggregation: "sum",
    unit: "count",
    breakdown: "source",
  },
  {
    kpi: "acquisition.failed",
    label: "Failed",
    group: "acquisition",
    aggregation: "sum",
    unit: "count",
    breakdown: "source",
  },
  {
    kpi: "acquisition.minutes_to_complete",
    label: "Time to complete",
    group: "acquisition",
    aggregation: "mean",
    unit: "minutes",
    breakdown: "source",
  },
  {
    kpi: "engagement.likes",
    label: "Likes",
    group: "engagement",
    aggregation: "sum",
    unit: "count",
  },
  {
    kpi: "engagement.follows",
    label: "Follows",
    group: "engagement",
    aggregation: "sum",
    unit: "count",
  },
  {
    kpi: "engagement.saved_albums",
    label: "Saved albums",
    group: "engagement",
    aggregation: "sum",
    unit: "count",
  },
  {
    kpi: "engagement.playlists_created",
    label: "Playlists created",
    group: "engagement",
    aggregation: "sum",
    unit: "count",
  },
  {
    kpi: "engagement.crates_created",
    label: "Crates created",
    group: "engagement",
    aggregation: "sum",
    unit: "count",
  },
  {
    kpi: "engagement.scrobbles_completed",
    label: "Scrobbles sent",
    group: "engagement",
    aggregation: "sum",
    unit: "count",
  },
  {
    kpi: "engagement.scrobbles_failed",
    label: "Scrobbles failed",
    group: "engagement",
    aggregation: "sum",
    unit: "count",
  },
  {
    kpi: "federation.active_peers",
    label: "Active peers",
    group: "federation",
    aggregation: "latest",
    unit: "count",
  },
  {
    kpi: "federation.remote_streams",
    label: "Remote streams",
    group: "federation",
    aggregation: "sum",
    unit: "count",
    breakdown: "direction",
  },
  {
    kpi: "federation.import_gib",
    label: "Federated imports",
    group: "federation",
    aggregation: "sum",
    unit: "gib",
  },
  {
    kpi: "streams.requests",
    label: "Streams",
    group: "federation",
    aggregation: "sum",
    unit: "count",
  },
  {
    kpi: "streams.gib",
    label: "Audio delivered",
    group: "federation",
    aggregation: "sum",
    unit: "gib",
  },
  {
    kpi: "streams.transcodes_completed",
    label: "Transcodes",
    group: "federation",
    aggregation: "sum",
    unit: "count",
  },
  {
    kpi: "streams.transcodes_failed",
    label: "Transcodes failed",
    group: "federation",
    aggregation: "sum",
    unit: "count",
  },
];

function aggregate(
  values: { day: string; value: number }[],
  aggregation: KpiAggregation,
): number | null {
  if (!values.length) return null;
  if (aggregation === "latest") {
    return values.reduce((latest, item) =>
      item.day > latest.day ? item : latest,
    ).value;
  }
  const total = values.reduce((sum, item) => sum + item.value, 0);
  return aggregation === "sum" ? total : total / values.length;
}

function windowValues(
  series: ProductKpiSeries,
  from: string,
  until: string,
): { day: string; value: number }[] {
  return series.points
    .filter(
      (point) =>
        point.day >= from && point.day <= until && point.value !== null,
    )
    .map((point) => ({ day: point.day, value: point.value as number }));
}

function dayBefore(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function combine(
  perSeries: (number | null)[],
  aggregation: KpiAggregation,
): number | null {
  const present = perSeries.filter((value): value is number => value !== null);
  if (!present.length) return null;
  const total = present.reduce((sum, value) => sum + value, 0);
  return aggregation === "mean" ? total / present.length : total;
}

export function summarizeKpi(
  definition: KpiDefinition,
  response: ProductKpiResponse,
): KpiReading {
  const series = response.series.filter((item) => item.kpi === definition.kpi);
  const previousEnd = dayBefore(response.current_start);
  const current = combine(
    series.map((item) =>
      aggregate(
        windowValues(item, response.current_start, response.end),
        definition.aggregation,
      ),
    ),
    definition.aggregation,
  );
  const previous = combine(
    series.map((item) =>
      aggregate(
        windowValues(item, response.previous_start, previousEnd),
        definition.aggregation,
      ),
    ),
    definition.aggregation,
  );
  const coveredDays = new Set(
    series.flatMap((item) =>
      item.points
        .filter(
          (point) =>
            point.day >= response.current_start && point.day <= response.end,
        )
        .map((point) => point.day),
    ),
  ).size;
  return {
    definition,
    value: current,
    previous,
    change:
      current === null || previous === null || previous === 0
        ? null
        : (current - previous) / previous,
    coveredDays,
  };
}

export function breakdownRows(
  definition: KpiDefinition,
  response: ProductKpiResponse,
): KpiBreakdownRow[] {
  if (!definition.breakdown) return [];
  const key = definition.breakdown;
  const rows = response.series
    .filter((item) => item.kpi === definition.kpi)
    .map((item) => {
      const inWindow = item.points.filter(
        (point) =>
          point.day >= response.current_start && point.day <= response.end,
      );
      const hidden =
        inWindow.length > 0 && inWindow.every((point) => point.suppressed);
      return {
        label: item.dims[key] ?? "unknown",
        value: hidden
          ? null
          : aggregate(
              windowValues(item, response.current_start, response.end),
              definition.aggregation,
            ),
        hidden,
      };
    })
    .filter((row) => row.hidden || row.value !== null);
  const visibleTotal = rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
  return rows
    .map((row) => ({
      ...row,
      share:
        row.value === null || visibleTotal === 0
          ? null
          : row.value / visibleTotal,
    }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
}

export function dailyValues(
  kpi: string,
  response: ProductKpiResponse,
): { day: string; value: number }[] {
  const series = response.series.find(
    (item) => item.kpi === kpi && Object.keys(item.dims).length === 0,
  );
  return series
    ? windowValues(series, response.current_start, response.end)
    : [];
}

const numberFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

export function formatKpiValue(value: number | null, unit: KpiUnit): string {
  if (value === null) return "—";
  switch (unit) {
    case "ratio":
      return `${decimalFormat.format(value * 100)}%`;
    case "hours":
      return `${decimalFormat.format(value)} h`;
    case "minutes":
      return `${decimalFormat.format(value)} min`;
    case "gib":
      return `${decimalFormat.format(value)} GiB`;
    default:
      return value >= 100
        ? numberFormat.format(value)
        : decimalFormat.format(value);
  }
}

export function formatChange(reading: KpiReading, windowDays: number): string {
  if (reading.value === null) return "No data in this window";
  if (reading.change === null)
    return `No comparable previous ${windowDays} days`;
  const percent = Math.round(reading.change * 100);
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent}% vs previous ${windowDays} days`;
}
