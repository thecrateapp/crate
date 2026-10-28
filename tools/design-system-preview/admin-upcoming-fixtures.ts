import fixture from "../../tests/admin-e2e/fixtures/upcoming-1ao.json";
export { artistPagePath } from "../../app/ui/src/lib/library-routes";
export const sampleImage = fixture.items.find((item) => item.type === "show")!.cover_url!;
export const artistPhotoApiUrl = () => sampleImage;
export const artistBackgroundApiUrl = () => sampleImage;
export type Sample = "ready" | "loading" | "empty";
export type Access = "admin" | "acquire" | "shows";
type SetlistStatus = "fresh" | "stale" | "missing" | "unknown";
type ArtistHealth = {
  status: SetlistStatus;
  generated_at: string | null;
  song_count: number;
  source_show_count: number | null;
  mode: string | null;
  tour_name: string | null;
};
const health: Record<string, ArtistHealth> = {
  "costa norte": {
    status: "fresh",
    generated_at: "2026-10-17T12:00:00Z",
    song_count: 14,
    source_show_count: 6,
    mode: "active_tour",
    tour_name: "Aguas quietas tour",
  },
  bruma: {
    status: "stale",
    generated_at: "2026-08-14T09:00:00Z",
    song_count: 11,
    source_show_count: 2,
    mode: "library_profile",
    tour_name: null,
  },
  "luz polar": {
    status: "missing",
    generated_at: null,
    song_count: 0,
    source_show_count: null,
    mode: null,
    tour_name: null,
  },
};
let state = {
  sample: "ready" as Sample,
  access: "admin" as Access,
  pending: 0,
  failNext: false,
  action: "Sin acciones de muestra.",
};
let items = structuredClone(fixture.items.filter((item) => item.type === "show"));
let finishers: (() => void)[] = [];
const listeners = new Set<() => void>();
function emit() {
  for (const fn of listeners) fn();
}
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function snapshot() {
  return state;
}
export function setFailure(failNext: boolean) {
  state = { ...state, failNext };
  emit();
}
export function setAccess(access: Access) {
  state = { ...state, access };
  emit();
}
export function setSample(sample: Sample) {
  if (state.pending) return;
  items =
    sample === "empty"
      ? []
      : structuredClone(fixture.items.filter((item) => item.type === "show"));
  state = {
    ...state,
    sample,
    action: "Sin acciones de muestra.",
    failNext: false,
  };
  emit();
}
function wait<T>(label: string, done: () => T): Promise<T> {
  const fail = state.failNext;
  state = {
    ...state,
    pending: state.pending + 1,
    failNext: false,
    action: label,
  };
  emit();
  return new Promise((resolve, reject) => {
    finishers.push(() => {
      state = {
        ...state,
        pending: state.pending - 1,
        action: fail
          ? "Fallo de muestra. Reintenta la acción."
          : label + " · Completado localmente.",
      };
      if (fail) reject(new Error("Intentional show management sample failure"));
      else resolve(done());
      emit();
    });
  });
}
export function complete() {
  const queue = finishers;
  finishers = [];
  for (const fn of queue) fn();
}
function currentHealth(name: string) {
  return health[name.trim().replace(/\s+/g, " ").toLowerCase()] ?? {
    status: "unknown" as const,
    generated_at: null,
    song_count: 0,
    source_show_count: null,
    mode: null,
    tour_name: null,
  };
}
function localItems() {
  return structuredClone(items).map((item, index) => {
    const artists = item.lineup_artists?.length
      ? item.lineup_artists
      : [{ name: item.artist, id: item.artist_id, slug: item.artist_slug }];
    const mainHealth = currentHealth(item.artist);
    const showId = item.show_id ?? 1_700_000 + index;
    return {
      id: String(showId),
      show_id: showId,
      artist_name: item.artist,
      artist_id: item.artist_id ?? null,
      artist_slug: item.artist_slug ?? null,
      date: item.date,
      local_time: item.time ?? null,
      venue: item.venue ?? null,
      address_line1: item.address_line1 ?? null,
      city: item.city ?? null,
      region: item.region ?? null,
      postal_code: item.postal_code ?? null,
      country: item.country ?? null,
      country_code: item.country_code ?? null,
      url: item.url
        ? `/admin-upcoming-demo.html?destino=${encodeURIComponent(item.url)}`
        : null,
      image_url: item.cover_url,
      lineup: item.lineup ?? [],
      artist_genres: item.genres ?? [],
      probable_setlist_status: mainHealth.status,
      probable_setlist_generated_at: mainHealth.generated_at,
      probable_setlist_song_count: mainHealth.song_count,
      probable_setlist_source_show_count: mainHealth.source_show_count,
      probable_setlist_mode: mainHealth.mode,
      probable_setlist_tour_name: mainHealth.tour_name,
      lineup_artists: artists.map((artist) => {
        const artistHealth = currentHealth(artist.name);
        return {
          name: artist.name,
          id: artist.id,
          slug: artist.slug,
          probable_setlist_status: artistHealth.status,
          probable_setlist_generated_at: artistHealth.generated_at,
          probable_setlist_song_count: artistHealth.song_count,
          probable_setlist_source_show_count: artistHealth.source_show_count,
          probable_setlist_mode: artistHealth.mode,
          probable_setlist_tour_name: artistHealth.tour_name,
        };
      }),
    };
  });
}
const coverage = () => ({
  artist_count: 3,
  fresh: 1,
  stale: 1,
  missing: 1,
  unknown: 0,
});
export async function api<T>(path: string, method = "GET"): Promise<T> {
  if (path === "/api/shows/cached?limit=5000" && method === "GET")
    return state.sample === "loading"
      ? wait(
          "Lectura de shows y setlists de muestra",
          () => ({ events: localItems(), setlist_coverage: coverage() }) as T,
        )
      : ({ events: localItems(), setlist_coverage: coverage() } as T);
  if (method !== "POST")
    throw new Error(`Unsupported show management specimen ${method} ${path}`);
  if (
    ![
      "/api/tasks/sync-shows",
      "/api/tasks/clean/completed",
      "/api/shows/probable-setlists/refresh",
    ].includes(path)
  )
    throw new Error("Unsupported show management specimen action");
  return wait(`${method} ${path}`, () => {
    if (path === "/api/shows/probable-setlists/refresh")
      return { ...coverage(), queued: 2 } as T;
    return { task_id: "sample-upcoming-task" } as T;
  });
}
