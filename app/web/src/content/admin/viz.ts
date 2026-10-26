export type Risk = "safe" | "caution" | "destructive";
export type Scope = "db" | "filesystem" | "hybrid";

export interface HealthCheck {
  id: string;
  label: string;
  description: string;
  risk: Risk;
  scope: Scope;
  confirm: boolean;
}

export const HEALTH_CHECKS: HealthCheck[] = [
  {
    id: "duplicate_folders",
    label: "Duplicate Folders",
    description: "Multiple folders that normalize to the same artist name",
    risk: "caution",
    scope: "filesystem",
    confirm: true,
  },
  {
    id: "canonical_mismatch",
    label: "Canonical Mismatch",
    description:
      "Folder name doesn't match the canonical artist name from tags",
    risk: "caution",
    scope: "hybrid",
    confirm: true,
  },
  {
    id: "artist_layout_fix",
    label: "Artist Layout Fix",
    description:
      "Artist filesystem layout or canonical entity-UID directory needs consolidation",
    risk: "caution",
    scope: "hybrid",
    confirm: true,
  },
  {
    id: "fk_orphan_albums",
    label: "Orphan Albums",
    description: "Albums in DB with no matching artist record",
    risk: "destructive",
    scope: "db",
    confirm: true,
  },
  {
    id: "fk_orphan_tracks",
    label: "Orphan Tracks",
    description: "Tracks in DB with no matching album record",
    risk: "destructive",
    scope: "db",
    confirm: true,
  },
  {
    id: "stale_artists",
    label: "Stale Artists",
    description: "Artists in DB with no folder on disk",
    risk: "caution",
    scope: "db",
    confirm: true,
  },
  {
    id: "stale_albums",
    label: "Stale Albums",
    description: "Albums in DB with no folder on disk",
    risk: "caution",
    scope: "db",
    confirm: true,
  },
  {
    id: "stale_tracks",
    label: "Stale Tracks",
    description: "Tracks in DB with no file on disk",
    risk: "safe",
    scope: "db",
    confirm: false,
  },
  {
    id: "zombie_artists",
    label: "Empty Artists",
    description: "Artists with 0 albums and 0 tracks",
    risk: "caution",
    scope: "db",
    confirm: true,
  },
  {
    id: "has_photo_desync",
    label: "Photo Desync",
    description: "Artist photo flag in DB doesn't match filesystem",
    risk: "safe",
    scope: "db",
    confirm: false,
  },
  {
    id: "duplicate_albums",
    label: "Duplicate Albums",
    description: "Same album name appears multiple times for an artist",
    risk: "caution",
    scope: "db",
    confirm: true,
  },
  {
    id: "duplicate_tracks",
    label: "Duplicate Tracks",
    description:
      "The same track appears more than once inside an album; the automatic cleanup skipped these",
    risk: "destructive",
    scope: "hybrid",
    confirm: true,
  },
  {
    id: "shadow_quality_tracks",
    label: "Lower Quality Copies",
    description:
      "Lower quality copies of tracks that already exist in a better format",
    risk: "destructive",
    scope: "hybrid",
    confirm: true,
  },
  {
    id: "unindexed_files",
    label: "Unindexed Files",
    description: "Audio files on disk not indexed in DB",
    risk: "caution",
    scope: "hybrid",
    confirm: true,
  },
  {
    id: "tag_mismatch",
    label: "Tag Mismatch",
    description: "Album artist tag doesn't match folder artist name",
    risk: "safe",
    scope: "db",
    confirm: false,
  },
  {
    id: "folder_naming",
    label: "Folder Naming",
    description: "Folder structure doesn't match the configured naming pattern",
    risk: "caution",
    scope: "filesystem",
    confirm: true,
  },
  {
    id: "missing_cover",
    label: "Missing Covers",
    description: "Albums without cover art (cover.jpg/cover.png)",
    risk: "safe",
    scope: "filesystem",
    confirm: false,
  },
];

export const RISK_LABELS: Record<Risk, string> = {
  safe: "Safe",
  caution: "Needs review",
  destructive: "Destructive",
};

export const EXAMPLE_FINDINGS: Record<string, number> = {
  canonical_mismatch: 2,
  stale_tracks: 14,
  has_photo_desync: 3,
  duplicate_albums: 1,
  shadow_quality_tracks: 6,
  unindexed_files: 9,
  missing_cover: 4,
};

export interface Genre {
  slug: string;
  top?: true;
  parents?: string[];
  related?: string[];
  eq?: string;
}

export const TAXONOMY_RELEASE = {
  id: "crate-core",
  version: "1.0.0",
  digest:
    "sha256:9d6af6a06c7b0d404820f2c4014d976a7251433ad3f61ddea3e03b7dc65c1de3",
  releasedAt: "2026-07-14",
};

export const RELATION_TYPES = [
  "parent",
  "related",
  "influenced_by",
  "fusion_of",
] as const;

export const GENRES: Genre[] = [
  { slug: "rock", top: true, eq: "rock" },
  { slug: "alternative", top: true, eq: "rock" },
  { slug: "metal", top: true, eq: "thrash" },
  { slug: "punk", top: true, eq: "punk" },
  { slug: "electronic", top: true, eq: "electronic" },
  { slug: "hip-hop", top: true, eq: "hip_hop" },
  { slug: "jazz", top: true, related: ["blues", "soul"], eq: "jazz" },
  { slug: "blues", top: true, related: ["jazz", "soul", "rock"], eq: "jazz" },
  { slug: "soul", top: true, related: ["funk", "blues", "jazz"], eq: "jazz" },
  { slug: "funk", parents: ["soul"], related: ["hip-hop", "electronic"] },
  {
    slug: "folk",
    top: true,
    related: ["country", "americana"],
    eq: "acoustic",
  },
  { slug: "country", top: true, related: ["folk", "rock"], eq: "acoustic" },
  { slug: "pop", top: true, eq: "pop" },
  { slug: "classical", top: true, related: ["ambient"], eq: "classical" },
  {
    slug: "ambient",
    top: true,
    related: ["classical", "electronic"],
    eq: "classical",
  },
  {
    slug: "indie-rock",
    parents: ["alternative"],
    related: ["garage-rock", "dream-pop", "shoegaze"],
    eq: "lo_fi",
  },
  {
    slug: "post-punk",
    parents: ["alternative"],
    related: ["gothic-rock", "new-wave", "art-punk", "shoegaze"],
  },
  {
    slug: "shoegaze",
    parents: ["alternative"],
    related: ["dream-pop", "noise-rock", "post-punk"],
    eq: "shoegaze",
  },
  {
    slug: "dream-pop",
    parents: ["alternative"],
    related: ["shoegaze", "post-punk", "indie-rock"],
    eq: "shoegaze",
  },
  {
    slug: "noise-rock",
    parents: ["alternative"],
    related: ["post-hardcore", "shoegaze", "art-punk"],
    eq: "shoegaze",
  },
  {
    slug: "new-wave",
    parents: ["alternative"],
    related: ["post-punk", "synthpop", "gothic-rock"],
    eq: "electronic",
  },
  {
    slug: "gothic-rock",
    parents: ["alternative"],
    related: ["post-punk", "new-wave"],
  },
  { slug: "garage-rock", parents: ["rock"], related: ["indie-rock", "punk"] },
  {
    slug: "psychedelic-rock",
    parents: ["rock"],
    related: ["stoner-rock", "doom-metal"],
    eq: "progressive",
  },
  {
    slug: "stoner-rock",
    parents: ["rock"],
    related: ["stoner-metal", "doom-metal", "psychedelic-rock"],
    eq: "doom",
  },
  {
    slug: "grunge",
    parents: ["rock"],
    related: ["alternative", "sludge-metal", "stoner-rock"],
  },
  {
    slug: "heavy-metal",
    parents: ["metal"],
    related: ["speed-metal", "power-metal", "thrash-metal", "doom-metal"],
    eq: "rock",
  },
  {
    slug: "thrash-metal",
    parents: ["metal"],
    related: ["speed-metal", "groove-metal", "heavy-metal", "crossover-thrash"],
  },
  {
    slug: "crossover-thrash",
    parents: ["metal"],
    related: ["thrash-metal", "hardcore-punk", "punk"],
  },
  {
    slug: "death-metal",
    parents: ["metal"],
    related: ["black-metal", "grindcore", "doom-metal"],
    eq: "death_metal",
  },
  {
    slug: "black-metal",
    parents: ["metal"],
    related: ["death-metal", "doom-metal", "post-metal"],
    eq: "black_metal",
  },
  {
    slug: "doom-metal",
    parents: ["metal"],
    related: ["sludge-metal", "stoner-metal", "heavy-metal", "post-metal"],
    eq: "doom",
  },
  {
    slug: "sludge-metal",
    parents: ["metal"],
    related: ["doom-metal", "stoner-metal", "post-metal", "hardcore-punk"],
    eq: "doom",
  },
  {
    slug: "stoner-metal",
    parents: ["metal"],
    related: ["doom-metal", "sludge-metal", "stoner-rock"],
    eq: "doom",
  },
  {
    slug: "groove-metal",
    parents: ["metal"],
    related: ["thrash-metal", "heavy-metal", "metalcore"],
  },
  {
    slug: "speed-metal",
    parents: ["metal"],
    related: ["heavy-metal", "thrash-metal", "power-metal"],
  },
  {
    slug: "power-metal",
    parents: ["metal"],
    related: ["heavy-metal", "speed-metal", "progressive-metal"],
    eq: "rock",
  },
  {
    slug: "progressive-metal",
    parents: ["metal"],
    related: ["post-metal", "power-metal", "metalcore"],
    eq: "progressive",
  },
  {
    slug: "industrial-metal",
    parents: ["metal"],
    related: ["industrial", "nu-metal"],
    eq: "electronic",
  },
  {
    slug: "post-metal",
    parents: ["metal"],
    related: ["sludge-metal", "doom-metal", "progressive-metal", "black-metal"],
    eq: "post_rock",
  },
  {
    slug: "metalcore",
    parents: ["metal"],
    related: [
      "hardcore-punk",
      "post-hardcore",
      "melodic-hardcore",
      "groove-metal",
    ],
    eq: "hardcore",
  },
  {
    slug: "grindcore",
    parents: ["metal"],
    related: ["death-metal", "hardcore-punk", "crust-punk"],
    eq: "death_metal",
  },
  {
    slug: "nu-metal",
    parents: ["metal"],
    related: ["industrial-metal", "alternative", "groove-metal"],
    eq: "hardcore",
  },
  {
    slug: "hardcore-punk",
    parents: ["punk"],
    related: [
      "melodic-hardcore",
      "post-hardcore",
      "crust-punk",
      "d-beat",
      "grindcore",
      "metalcore",
      "crossover-thrash",
    ],
    eq: "hardcore",
  },
  {
    slug: "beatdown-hardcore",
    parents: ["hardcore-punk"],
    related: ["metalcore", "sludge-metal", "crossover-thrash"],
  },
  {
    slug: "powerviolence",
    parents: ["hardcore-punk"],
    related: ["grindcore", "d-beat", "crust-punk"],
  },
  {
    slug: "melodic-hardcore",
    parents: ["punk"],
    related: ["hardcore-punk", "post-hardcore", "skate-punk", "emo"],
    eq: "hardcore",
  },
  {
    slug: "post-hardcore",
    parents: ["punk"],
    related: [
      "hardcore-punk",
      "melodic-hardcore",
      "emo",
      "screamo",
      "noise-rock",
      "metalcore",
    ],
    eq: "hardcore",
  },
  {
    slug: "skate-punk",
    parents: ["punk"],
    related: ["melodic-hardcore", "pop-punk", "hardcore-punk"],
  },
  {
    slug: "pop-punk",
    parents: ["punk"],
    related: ["skate-punk", "emo", "alternative"],
  },
  {
    slug: "crust-punk",
    parents: ["punk"],
    related: ["d-beat", "hardcore-punk", "grindcore", "sludge-metal"],
  },
  {
    slug: "d-beat",
    parents: ["punk"],
    related: ["crust-punk", "hardcore-punk"],
  },
  {
    slug: "anarcho-punk",
    parents: ["punk"],
    related: ["art-punk", "crust-punk", "hardcore-punk"],
  },
  {
    slug: "art-punk",
    parents: ["punk"],
    related: ["post-punk", "noise-rock", "anarcho-punk"],
  },
  {
    slug: "emo",
    parents: ["punk"],
    related: ["post-hardcore", "screamo", "melodic-hardcore", "indie-rock"],
    eq: "lo_fi",
  },
  {
    slug: "screamo",
    parents: ["punk"],
    related: ["emo", "post-hardcore", "hardcore-punk"],
    eq: "hardcore",
  },
  {
    slug: "industrial",
    parents: ["electronic"],
    related: ["industrial-metal", "new-wave"],
  },
  {
    slug: "synthpop",
    parents: ["electronic"],
    related: ["new-wave", "dream-pop"],
  },
  { slug: "techno", parents: ["electronic"], related: ["house", "industrial"] },
  { slug: "house", parents: ["electronic"], related: ["techno", "electronic"] },
  {
    slug: "trip-hop",
    parents: ["electronic"],
    related: ["hip-hop", "ambient"],
    eq: "hip_hop",
  },
];

export const EQ_WALK = [
  "powerviolence",
  "post-punk",
  "funk",
  "thrash-metal",
  "techno",
  "gothic-rock",
  "crust-punk",
];

export const ENRICHMENT = {
  parallelism: 3,
  artist: [
    { id: "lastfm", label: "Last.fm", ttlDays: 7, interval: 0.25 },
    { id: "spotify", label: "Spotify", ttlDays: 3, interval: 0.15 },
    { id: "musicbrainz", label: "MusicBrainz", ttlDays: 30, interval: 1.1 },
    { id: "setlist", label: "Setlist.fm", ttlDays: 1, interval: 1 },
    { id: "fanart", label: "Fanart.tv", ttlDays: 30, interval: 1 },
    { id: "discogs", label: "Discogs", ttlDays: 30, interval: 1 },
  ],
  more: [
    { label: "Cover Art Archive", role: "album covers" },
    { label: "Deezer · iTunes", role: "image fallback" },
    { label: "Wikidata", role: "identity" },
    { label: "Wikipedia", role: "context" },
    { label: "Ticketmaster", role: "shows" },
    { label: "lrclib", role: "synced lyrics" },
    { label: "Bandcamp", role: "links" },
  ],
};

export const RELEASE_STAGES = [
  {
    id: "detected",
    title: "Detected",
    task: "check_new_releases",
    body: "Found before its release date, so it is kept as a pre-release.",
    steps: ["status: detected"],
  },
  {
    id: "release-day",
    title: "Release day",
    task: "promote_due_releases",
    body: "Pre-releases that are now out are queued for download.",
    steps: ["release_date ≤ today"],
  },
  {
    id: "fetched",
    title: "Fetched",
    task: "tidal_download",
    body: "Downloaded through an integration you configured.",
    steps: ["queued", "downloading", "processing", "completed"],
  },
  {
    id: "imported",
    title: "Imported",
    task: "process_new_content",
    body: "Organised, enriched and indexed.",
    steps: ["folders", "artist", "genres", "MBIDs", "Bandcamp", "lyrics"],
  },
  {
    id: "analysed",
    title: "Analysed",
    task: "analysis daemon",
    body: "New tracks wait as pending until the daemons analyse them.",
    steps: ["features", "bliss"],
  },
];

export const GOVERNOR = {
  loadRatio: 0.85,
  iowaitPercent: 25,
  swapPercent: 30,
  swapMinUsedMb: 512,
  minMemoryAvailablePercent: 15,
  maxActiveUsers: 10,
  maxActiveStreams: 10,
  deferSeconds: 300,
  window: ["02:00", "07:00"] as const,
};

export const GOVERNED_TASKS = [
  "agent_maintenance",
  "backfill_artwork_variants",
  "backfill_smart_mix_profiles",
  "backfill_track_audio_fingerprints",
  "batch_covers",
  "batch_retag",
  "cleanup_artwork_variants",
  "compute_analytics",
  "compute_popularity",
  "compute_smart_mix_profile",
  "enrich_mbids",
  "export_rich_metadata",
  "fetch_artwork_all",
  "fix_artist",
  "fix_issues",
  "generate_cast_spectrum",
  "health_check",
  "library_pipeline",
  "library_sync",
  "materialize_artwork_variants",
  "migrate_storage_v2",
  "prepare_library_repairs",
  "process_new_content",
  "quality_check",
  "rebuild_library",
  "rehydrate_portable_metadata",
  "repair",
  "repair_artwork_variants",
  "resolve_duplicates",
  "scan",
  "scan_missing_covers",
  "show_extract",
  "verify_storage_v2",
  "warmup_stream_variants",
  "wipe_library",
  "write_portable_metadata",
];

export const QUEUE_ORDER = [
  "maintenance",
  "default",
  "fast",
  "heavy",
  "playback",
] as const;

export const QUEUE_PICKS: Record<(typeof QUEUE_ORDER)[number], string[]> = {
  maintenance: [
    "health_check",
    "fix_issues",
    "compute_analytics",
    "enrich_mbids",
    "sync_lyrics",
    "batch_covers",
    "check_new_releases",
  ],
  default: [
    "import_queue_item",
    "process_new_content",
    "update_album_tags",
    "library_album_merge",
    "tidal_download",
  ],
  fast: [
    "enrich_artist",
    "fetch_album_cover",
    "analyze_tracks",
    "refresh_user_listening_stats",
    "compute_bliss",
  ],
  heavy: ["backfill_track_audio_fingerprints", "generate_cast_spectrum"],
  playback: ["prepare_stream_variant"],
};

export const IDENTITY_TAGS = [
  "crate_artist_uid",
  "crate_album_uid",
  "crate_track_uid",
  "crate_audio_fingerprint",
];

export const SIDECAR_TRACKS = [
  "Alison",
  "Machine Gun",
  "40 Days",
  "Sing",
  "Here She Comes",
  "Souvlaki Space Station",
  "When the Sun Hits",
  "Altogether",
  "Melon Yellow",
  "Dagger",
];

export const SIDECAR = {
  album: {
    artist: "Slowdive",
    artwork_files: ["cover.jpg"],
    entity_uid: "1c9a2b45-b265-5625-b7ac-4f8eab13ab2e",
    genre: "Shoegaze",
    musicbrainz_albumid: null,
    name: "Souvlaki",
    path: "/music/Slowdive/Souvlaki",
    track_count: 10,
    year: "1993",
  },
  artist: {
    country: "GB",
    entity_uid: "dd335d6e-20e9-53c1-852c-b65ecdd1fbf6",
    name: "Slowdive",
  },
  generated_at: "2026-10-14T09:12:03+00:00",
  schema_version: 1,
  tracks: [
    {
      analysis: {
        audio_key: "D",
        audio_scale: "major",
        bpm: 103.4,
        energy: 0.48,
        loudness: -11.2,
      },
      bliss: {
        vector: [
          0.412, -0.137, 0.268, -0.521, 0.093, 0.334, -0.208, 0.157, -0.046,
          0.389, -0.301, 0.122, 0.071, -0.264, 0.198, -0.087, 0.243, -0.159,
          0.036, 0.117,
        ],
      },
      entity_uid: "203e2dd3-5cdc-580c-a43b-6c54fd1dade6",
      filename: "01 - Alison.flac",
      format: "flac",
      title: "Alison",
      track_number: 1,
    },
  ],
};

export interface ExampleTrack {
  title: string;
  bpm: number;
  key: string;
  camelot: string;
  loudness: number;
  dynamicRange: number;
  features: Record<
    "energy" | "danceability" | "valence" | "acousticness" | "instrumentalness",
    number
  >;
  seed: number;
}

export const EXAMPLE_TRACKS: ExampleTrack[] = [
  {
    title: "Alison",
    bpm: 103.4,
    key: "D major",
    camelot: "10B",
    loudness: -11.2,
    dynamicRange: 9.8,
    features: {
      energy: 0.48,
      danceability: 0.41,
      valence: 0.37,
      acousticness: 0.12,
      instrumentalness: 0.31,
    },
    seed: 0,
  },
  {
    title: "When the Sun Hits",
    bpm: 126.1,
    key: "A major",
    camelot: "11B",
    loudness: -10.4,
    dynamicRange: 8.9,
    features: {
      energy: 0.66,
      danceability: 0.38,
      valence: 0.29,
      acousticness: 0.06,
      instrumentalness: 0.22,
    },
    seed: 7,
  },
  {
    title: "40 Days",
    bpm: 137.8,
    key: "E minor",
    camelot: "9A",
    loudness: -10.9,
    dynamicRange: 9.1,
    features: {
      energy: 0.61,
      danceability: 0.44,
      valence: 0.33,
      acousticness: 0.04,
      instrumentalness: 0.18,
    },
    seed: 3,
  },
];
