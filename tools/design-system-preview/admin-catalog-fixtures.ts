import type { UseApiState } from "../../app/shared/web/use-api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const artists = [
  {
    id: 31,
    entity_uid: "artist-converge",
    slug: "converge",
    name: "Converge",
    albums: 11,
    tracks: 146,
    total_size_mb: 2840,
    has_photo: true,
    primary_format: "flac",
    listeners: 18200,
    genres: ["metalcore", "mathcore"],
    is_featured: true,
    featured_devices: ["listen"],
  },
  {
    id: 32,
    entity_uid: "artist-visions",
    slug: "visions-of-disorder",
    name: "Vision of Disorder",
    albums: 7,
    tracks: 83,
    total_size_mb: 1660,
    has_photo: true,
    primary_format: "flac",
    listeners: 4200,
    genres: ["hardcore", "metalcore"],
  },
  {
    id: 33,
    entity_uid: "artist-russian-circles",
    slug: "russian-circles",
    name: "Russian Circles",
    albums: 9,
    tracks: 91,
    total_size_mb: 2180,
    has_photo: true,
    primary_format: "flac",
    listeners: 9700,
    genres: ["post-metal", "post-rock"],
  },
  {
    id: 34,
    entity_uid: "artist-jeromes-dream",
    slug: "jeromes-dream",
    name: "Jeromes Dream",
    albums: 5,
    tracks: 77,
    total_size_mb: 930,
    has_photo: false,
    primary_format: "mp3",
    listeners: 1600,
    genres: ["screamo", "emoviolence"],
    has_issues: true,
  },
  {
    id: 35,
    entity_uid: "artist-boris",
    slug: "boris",
    name: "Boris",
    albums: 18,
    tracks: 246,
    total_size_mb: 5120,
    has_photo: true,
    primary_format: "flac",
    listeners: 13800,
    genres: ["drone metal", "noise rock"],
  },
  {
    id: 36,
    entity_uid: "artist-unwound",
    slug: "unwound",
    name: "Unwound",
    albums: 8,
    tracks: 132,
    total_size_mb: 2010,
    has_photo: true,
    primary_format: "flac",
    listeners: 6100,
    genres: ["post-hardcore", "noise rock"],
  },
];

const genres = [
  {
    id: 1,
    name: "Mathcore",
    slug: "mathcore",
    artist_count: 18,
    album_count: 74,
    mapped: true,
    canonical_slug: "mathcore",
    canonical_name: "Mathcore",
    top_level_name: "Metal",
  },
  {
    id: 2,
    name: "Post-Metal",
    slug: "post-metal",
    artist_count: 42,
    album_count: 188,
    mapped: true,
    canonical_slug: "post-metal",
    canonical_name: "Post-Metal",
    top_level_name: "Metal",
  },
  {
    id: 3,
    name: "Noise Rock",
    slug: "noise-rock",
    artist_count: 36,
    album_count: 145,
    mapped: true,
    canonical_slug: "noise-rock",
    canonical_name: "Noise Rock",
    top_level_name: "Rock",
  },
  {
    id: 4,
    name: "Emoviolence",
    slug: "emoviolence",
    artist_count: 8,
    album_count: 29,
    mapped: false,
  },
  {
    id: 5,
    name: "Screamo",
    slug: "screamo",
    artist_count: 29,
    album_count: 108,
    mapped: true,
    canonical_slug: "screamo",
    canonical_name: "Screamo",
    top_level_name: "Punk",
  },
  {
    id: 6,
    name: "Post-Rock",
    slug: "post-rock",
    artist_count: 63,
    album_count: 320,
    mapped: true,
    canonical_slug: "post-rock",
    canonical_name: "Post-Rock",
    top_level_name: "Rock",
  },
  {
    id: 7,
    name: "Sludge",
    slug: "sludge",
    artist_count: 24,
    album_count: 96,
    mapped: false,
  },
  {
    id: 8,
    name: "Hardcore Punk",
    slug: "hardcore-punk",
    artist_count: 55,
    album_count: 233,
    mapped: true,
    canonical_slug: "hardcore-punk",
    canonical_name: "Hardcore Punk",
    top_level_name: "Punk",
  },
];

const filterOptions = {
  genres: [
    { name: "Mathcore", count: 18 },
    { name: "Post-Metal", count: 42 },
    { name: "Noise Rock", count: 36 },
    { name: "Post-Rock", count: 63 },
  ],
  countries: [
    { name: "United States", count: 288 },
    { name: "United Kingdom", count: 152 },
    { name: "Japan", count: 84 },
  ],
  decades: ["1980s", "1990s", "2000s", "2010s", "2020s"],
  formats: [
    { name: "FLAC", count: 684 },
    { name: "MP3", count: 193 },
  ],
};

export async function api<T>(url: string): Promise<T> {
  if (url.startsWith("/api/browse/filters")) return filterOptions as T;
  if (url.startsWith("/api/artists?"))
    return {
      items: artists,
      total: 684,
      page: 1,
      per_page: 60,
    } as T;
  if (url === "/api/genres/index") return { task_id: "sample-task" } as T;
  throw new Error(`Unsupported catalog preview request: ${url}`);
}

export function useApi<T>(url: string | null): UseApiState<T> {
  const data =
    url === "/api/genres"
      ? genres
      : url === "/api/genres/unmapped?limit=100"
        ? genres.filter((genre) => !genre.mapped)
        : null;
  return {
    data: data as T | null,
    loading: false,
    error: null,
    refetch: () => {},
  };
}

export function useTaskPoll() {
  return { pollTask: () => {} };
}

export function artistPagePath({
  artistSlug,
  artistName,
}: {
  artistSlug?: string;
  artistName?: string;
}) {
  return `/artists/${artistSlug || artistName?.toLowerCase().replace(/\s+/g, "-") || "artist"}`;
}

export function artistPhotoApiUrl({ artistName }: { artistName?: string }) {
  const name = artistName || "Artist";
  const initial = name.slice(0, 1).toUpperCase();
  const color = ["#166b75", "#65477d", "#875a38", "#355d75"][
    name.charCodeAt(0) % 4
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" fill="#14181b"/><circle cx="120" cy="120" r="91" fill="${color}" opacity=".72"/><path d="M0 190 240 55v185H0z" fill="#080b0d" opacity=".45"/><text x="120" y="151" fill="#e8f7f9" font-family="sans-serif" font-size="104" font-weight="700" text-anchor="middle">${initial}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const catalogPreviewData = { artists, genres };
