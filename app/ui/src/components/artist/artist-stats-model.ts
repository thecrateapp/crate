import { albumCoverApiUrl } from "@/lib/library-routes";
import type { ArtistData } from "./artistPageTypes";

export interface AlbumObservationMetadata {
  value: string;
  title: string;
  year: string | null;
  coverUrl?: string;
  detail?: string;
}

export interface ReleaseObservation {
  name: string;
  year: string | null;
  track_count: number;
  total_duration?: number | null;
  popularity?: number | null;
  lastfm_listeners?: number | null;
}
export interface AudioObservation {
  album: string;
  year?: string | null;
  avg_bpm: number | null;
  avg_loudness?: number | null;
  avg_energy: number | null;
  avg_danceability?: number | null;
  avg_valence?: number | null;
  avg_acousticness?: number | null;
}
export interface ArtistStatsData {
  formats: { id: string; value: number }[];
  albums_timeline: ReleaseObservation[];
  audio_by_album: AudioObservation[];
  top_tracks_by_popularity: {
    title: string;
    album: string;
    popularity: number | null;
    popularity_score?: number | null;
    duration?: number | null;
    bpm?: number | null;
    energy?: number | null;
    lastfm_listeners: number | null;
  }[];
  genres: { name: string; weight: number | null }[];
}

export interface ArtistAnalysisTrack {
  track_id?: number | null;
  track_entity_uid?: string | null;
  entity_uid?: string | null;
  album_id?: number | null;
  tempo?: number | null;
  smart_mix?: {
    quality?: string | null;
    is_current_full_profile?: boolean;
  } | null;
  bliss?: { available?: boolean } | null;
}

/** The artist's stored total and the local timeline share the library scope. */
export function catalogueTrackCount(
  rows: readonly ReleaseObservation[],
  storedTotal?: number,
): number | null {
  if (
    available(storedTotal) &&
    Number.isInteger(storedTotal) &&
    storedTotal >= 0
  )
    return storedTotal;
  if (
    rows.some(
      (row) =>
        !available(row.track_count) ||
        !Number.isInteger(row.track_count) ||
        row.track_count < 0,
    )
  )
    return null;
  return rows.reduce((total, row) => total + row.track_count, 0);
}

/** Editorial weights rank tags; they do not represent a share of local tracks. */
export function predominantGenre(
  profile: ArtistData["genre_profile"],
  genres: ArtistStatsData["genres"],
): string | null {
  const strongest = (
    rows: readonly { name: string; weight?: number | null }[],
  ) => {
    let result: (typeof rows)[number] | undefined;
    for (const row of rows) {
      if (!row.name.trim() || !available(row.weight)) continue;
      if (!result || row.weight > result.weight!) result = row;
    }
    return result?.name.trim() ?? null;
  };
  return strongest(profile ?? []) ?? strongest(genres);
}

/** Resolve aliases before calculating readings: a track contributes at most once. */
export function artistAnalysisReadout(
  data: Record<string, ArtistAnalysisTrack>,
) {
  type TrackGroup = {
    rows: ArtistAnalysisTrack[];
    aliases: Set<string>;
  };
  const identities = new Map<string, TrackGroup>();
  const groups = new Set<TrackGroup>();
  let unidentified = false;
  for (const [key, row] of Object.entries(data)) {
    const aliases: string[] = [];
    const uid = row.track_entity_uid || row.entity_uid;
    if (uid) aliases.push(`uid:${uid}`);
    const id =
      row.track_id ?? (/^track:\d+$/.test(key) ? Number(key.slice(6)) : null);
    if (available(id) && Number.isInteger(id) && id > 0)
      aliases.push(`id:${id}`);
    if (!aliases.length) {
      unidentified = true;
      continue;
    }
    const matches = new Set(
      aliases.map((alias) => identities.get(alias)).filter((group) => !!group),
    );
    const group = matches.values().next().value ?? {
      rows: [],
      aliases: new Set<string>(),
    };
    for (const other of matches) {
      if (other === group) continue;
      group.rows.push(...other.rows);
      for (const alias of other.aliases) {
        group.aliases.add(alias);
        identities.set(alias, group);
      }
      groups.delete(other);
    }
    group.rows.push(row);
    for (const alias of aliases) {
      group.aliases.add(alias);
      identities.set(alias, group);
    }
    groups.add(group);
  }
  const tempos: number[] = [];
  const smartMix: (boolean | null)[] = [];
  const bliss: (boolean | null)[] = [];
  for (const { rows } of groups) {
    const tempo = rows.find(
      (row) => available(row.tempo) && row.tempo > 0,
    )?.tempo;
    if (available(tempo)) tempos.push(tempo);
    const mixStates = rows.map((row) =>
      row.smart_mix === null ? false : row.smart_mix?.is_current_full_profile,
    );
    smartMix.push(
      mixStates.includes(false)
        ? false
        : mixStates.includes(true)
          ? true
          : null,
    );
    const blissStates = rows.map((row) => row.bliss?.available);
    bliss.push(
      blissStates.includes(false)
        ? false
        : blissStates.includes(true)
          ? true
          : null,
    );
  }
  const covered = (states: (boolean | null)[]) =>
    unidentified || states.includes(null)
      ? null
      : states.filter((state) => state === true).length;
  return {
    uniqueTracks: groups.size,
    measuredTracks: tempos.length,
    meanBpm: tempos.length
      ? tempos.reduce((sum, tempo) => sum + tempo, 0) / tempos.length
      : null,
    smartMixTracks: covered(smartMix),
    blissTracks: covered(bliss),
  };
}
export function available(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
export function releaseYear(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  if (year < 1) return null;
  if (value.length > 4) {
    const date = new Date(
      `${value.length === 7 ? `${value}-01` : value}T00:00:00Z`,
    );
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, value.length) !== value
    )
      return null;
  }
  return year;
}
/** Prefer the latest valid calendar date; unknown dates only win when all are unknown. */
export function mostRecentObservationId<
  T extends { id: string; year?: string | null },
>(rows: readonly T[]): string {
  let recent = rows[0];
  let recentDate = -1;
  for (const row of rows) {
    if (releaseYear(row.year) == null) continue;
    const [year, month = 0, day = 0] = row.year!.split("-").map(Number);
    const date = year! * 10000 + month * 100 + day;
    if (date > recentDate) {
      recent = row;
      recentDate = date;
    }
  }
  return recent?.id ?? "";
}
export function releaseObservations(rows: ReleaseObservation[]) {
  const years = rows
    .map((row) => releaseYear(row.year))
    .filter((year): year is number => year != null);
  const first = Math.min(...years);
  const last = Math.max(...years);
  const lanes = new Map<number | null, number>();
  return rows.map((row, index) => {
    const yearValue = releaseYear(row.year);
    const lane = lanes.get(yearValue) ?? 0;
    lanes.set(yearValue, lane + 1);
    return {
      ...row,
      id: `release-${index}`,
      yearValue,
      lane,
      position:
        yearValue == null
          ? null
          : first === last
            ? 0.5
            : (yearValue - first) / (last - first),
    };
  });
}
export function audioObservations(rows: AudioObservation[]) {
  return rows.map((row, index) => ({
    ...row,
    id: `audio-${index}`,
    plottable:
      available(row.avg_bpm) &&
      row.avg_bpm > 0 &&
      available(row.avg_energy) &&
      row.avg_energy >= 0 &&
      row.avg_energy <= 1,
  }));
}
export function catalogueReadout(rows: ReleaseObservation[]) {
  const years = rows
    .map((row) => releaseYear(row.year))
    .filter((year): year is number => year != null);
  const durations = rows
    .map((row) => row.total_duration)
    .filter(
      (duration): duration is number => available(duration) && duration >= 0,
    );
  return {
    firstYear: years.length ? Math.min(...years) : null,
    lastYear: years.length ? Math.max(...years) : null,
    duration: durations.length
      ? durations.reduce((sum, value) => sum + value, 0)
      : null,
  };
}
export function rankAlbums(
  rows: ReleaseObservation[],
  unit: "popularity" | "lastfm_listeners",
) {
  return rows
    .map((row, index) => ({
      id: `release-${index}`,
      label: row.name,
      value: row[unit],
    }))
    .filter((row): row is { id: string; label: string; value: number } =>
      available(row.value),
    )
    .sort((a, b) => b.value - a.value);
}
export function formatShares(rows: ArtistStatsData["formats"]) {
  const known = rows.filter(
    (row) =>
      row.id.trim() &&
      !/^(unknown|none|null|n\/a)$/i.test(row.id.trim()) &&
      available(row.value) &&
      row.value > 0,
  );
  const total = known.reduce((sum, row) => sum + row.value, 0);
  return known.map((row) => ({ ...row, share: row.value / total }));
}
export function durationReading(value: number | null | undefined) {
  if (!available(value) || value < 0) return "Unavailable";
  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
}

/** Direct plot inspection uses distance, independently of SVG paint order. */
export function nearestObservation<
  T extends { id: string; x: number; y: number },
>(
  points: readonly T[],
  x: number,
  y: number,
  selectedId?: string,
): T | undefined {
  let nearest: T | undefined;
  let distance = Infinity;
  for (const point of points) {
    const candidate = (point.x - x) ** 2 + (point.y - y) ** 2;
    if (
      candidate < distance ||
      (candidate === distance && point.id === selectedId)
    ) {
      nearest = point;
      distance = candidate;
    }
  }
  return nearest;
}

/** Resolve observation cover and year only from an unambiguous catalogue match. */
export function albumObservationMetadata(
  rows: readonly { id: string; title: string; year?: string | null }[],
  catalogue: ArtistData["albums"] = [],
): AlbumObservationMetadata[] {
  const items = rows.map((row) => {
    const year = releaseYear(row.year);
    const matching = catalogue.filter(
      (album) =>
        album.name === row.title &&
        (row.year === undefined ||
          (year != null && releaseYear(album.year) === year)),
    );
    const album = matching.length === 1 ? matching[0] : undefined;
    const resolvedYear =
      year ??
      (row.year === undefined && album ? releaseYear(album.year) : null);
    return {
      value: row.id,
      title: row.title,
      year: resolvedYear == null ? null : String(resolvedYear),
      coverUrl:
        album?.has_cover && (album.id != null || album.entity_uid)
          ? albumCoverApiUrl({
              albumId: album.id,
              albumEntityUid: album.entity_uid,
            })
          : undefined,
    };
  });
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = JSON.stringify([item.title, item.year]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const occurrences = new Map<string, number>();
  return items.map((item) => {
    const key = JSON.stringify([item.title, item.year]);
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    const count = counts.get(key)!;
    return {
      ...item,
      detail: count > 1 ? `Observation ${occurrence} of ${count}` : undefined,
    };
  });
}

/** Dated lookups require a dated match; legacy source lookups require a unique title. */
export function matchAlbumObservation<T extends { year?: string | null }>(
  title: string,
  year: string | null | undefined,
  rows: readonly T[],
  titleOf: (row: T) => string,
): T | undefined {
  if (year !== undefined && releaseYear(year) == null) return undefined;
  const names = rows.filter((row) => titleOf(row) === title);
  const matching =
    year === undefined
      ? names
      : names.filter((row) => releaseYear(row.year) === releaseYear(year));
  return matching.length === 1 ? matching[0] : undefined;
}
