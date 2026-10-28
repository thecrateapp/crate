export const EQ_BANDS = [
  "32",
  "64",
  "125",
  "250",
  "500",
  "1K",
  "2K",
  "4K",
  "8K",
  "16K",
] as const;

export const EQ_GAIN_MAX = 12;

export const EQ_PRESETS: Record<string, readonly number[]> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  rock: [4, 3, -1, -3, -2, 1, 3, 5, 5, 5],
  pop: [-1, 2, 4, 4, 2, -1, -1, -1, -1, -1],
  jazz: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
  classical: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
  bass_boost: [7, 6, 4, 2, 0, -1, -2, -2, -2, -2],
  treble_boost: [-2, -2, -2, -1, 0, 1, 3, 5, 6, 7],
  vocal: [-2, -3, -3, 1, 4, 4, 3, 1, 0, -1],
  electronic: [5, 4, 1, -1, -2, 1, 0, 1, 4, 5],
  acoustic: [4, 3, 2, 1, 2, 2, 3, 3, 2, 1],
  black_metal: [-1, 3, 4, 1, -3, -2, 3, 6, 6, 4],
  death_metal: [2, 5, 6, 4, -3, -2, 4, 5, 2, 0],
  thrash: [3, 5, 4, 0, -4, -3, 2, 5, 6, 5],
  doom: [6, 6, 5, 3, 0, -2, -3, -3, -2, -1],
  hardcore: [4, 4, 2, -1, 1, 3, 5, 4, 2, 1],
  punk: [2, 3, 1, -1, 2, 4, 4, 3, 1, -1],
  progressive: [2, 2, 1, 0, 0, 0, 1, 2, 3, 3],
  shoegaze: [1, 2, 3, 3, 4, 3, 2, 1, 0, 0],
  post_rock: [2, 2, 2, 1, 0, 0, 1, 2, 3, 3],
  lo_fi: [1, 2, 2, 1, 1, 0, 0, 1, 2, 1],
  hip_hop: [6, 5, 3, 1, 0, 1, 2, 3, 3, 2],
};

export const EQ_CYCLE = [
  "black_metal",
  "jazz",
  "shoegaze",
  "hip_hop",
  "classical",
  "doom",
  "electronic",
  "post_rock",
  "thrash",
  "punk",
];

export const SMART_EQ_CHAIN = [
  "your preset",
  "curator track",
  "curator album",
  "genre",
  "analysis",
  "flat",
];

export interface MoodFilter {
  energy_min?: number;
  energy_max?: number;
  valence_min?: number;
  valence_max?: number;
  danceability_min?: number;
  acousticness_min?: number;
}

export interface Mood {
  id: string;
  label: string;
  filters: MoodFilter;
  lean?: { energy?: number; valence?: number };
}

export const MOODS: Mood[] = [
  {
    id: "energetic",
    label: "Energetic",
    filters: { energy_min: 0.7, danceability_min: 0.5 },
    lean: { valence: 0.62 },
  },
  {
    id: "chill",
    label: "Chill",
    filters: { energy_max: 0.4, valence_min: 0.3 },
  },
  {
    id: "dark",
    label: "Dark",
    filters: { valence_max: 0.3, energy_min: 0.4 },
  },
  {
    id: "happy",
    label: "Happy",
    filters: { valence_min: 0.6, energy_min: 0.4 },
  },
  {
    id: "melancholy",
    label: "Melancholy",
    filters: { valence_max: 0.35, energy_max: 0.5 },
  },
  {
    id: "intense",
    label: "Intense",
    filters: { energy_min: 0.8 },
    lean: { valence: 0.32 },
  },
  {
    id: "groovy",
    label: "Groovy",
    filters: { danceability_min: 0.65, energy_min: 0.45 },
    lean: { energy: 0.6, valence: 0.6 },
  },
  {
    id: "acoustic",
    label: "Acoustic",
    filters: { acousticness_min: 0.6 },
    lean: { energy: 0.3, valence: 0.48 },
  },
];

export const STATS = {
  period: "Last 12 months",
  hours: 1284,
  artists: 418,
  topGenre: "post-punk",
};

export const MIX = {
  beats: 12,
  prerollMs: 2_500,
  lockWindowMs: 10,
  tempoRestoreMs: 4_000,
  tempoRatio: { min: 0.94, max: 1.06 },
  bus: { sampleRate: 48_000, blockFrames: 480 },
  bass: { shelfHz: 150, cutDb: -24, swapFraction: 0.125 },
  planner: {
    maxTempoChange: 0.04,
    minBeatmatchBeats: 8,
    maxLoudnessDb: 6,
    truePeakDbtp: -1,
    minTransitionMs: 1_000,
    maxTransitionMs: 12_000,
  },
  a: { label: "A · outgoing", bpm: 124, key: "8A", lufs: -10.4 },
  b: {
    label: "B · incoming",
    bpm: 120,
    key: "9A",
    lufs: -9.1,
    looseOffsetMs: 210,
  },
};

export const FEDERATION = {
  yours: { id: "yours", label: "your node", key: "ed25519 · 4c1e…9a07" },
  peers: [
    { id: "north", label: "north.crate", key: "ed25519 · 9f2c…a1d3" },
    { id: "basement", label: "basement.crate", key: "ed25519 · 03be…77f0" },
    { id: "club", label: "radio-club.crate", key: "ed25519 · e81a…2c54" },
  ],
  steps: [
    {
      title: "Descriptor",
      body: "NodeDescriptorV1, signed with the peer's Ed25519 key.",
    },
    { title: "Pairing", body: "Pending until an operator approves it." },
    { title: "Grant", body: "Typed grants decide what the peer may serve." },
    {
      title: "Relay",
      body: "Playback flows through your node with an opaque ticket.",
    },
  ],
};

export const DEVICES = [
  { id: "desktop", label: "macOS · Windows · Linux" },
  { id: "android", label: "Android · Smart Mix" },
  { id: "pwa", label: "PWA · iPhone" },
  { id: "cast", label: "Google Cast" },
  { id: "subsonic", label: "OpenSubsonic" },
];

export const SETLIST = {
  artist: "Slowdive",
  date: "Sat 21 Nov",
  venue: "Razzmatazz, Barcelona",
  source: "12 recent shows · Setlist.fm",
  tracks: [
    { title: "Shanty", owned: true },
    { title: "Star Roving", owned: true },
    { title: "Catch the Breeze", owned: true },
    { title: "Skin in the Game", owned: false },
    { title: "Kisses", owned: true },
    { title: "Chained to a Cloud", owned: true },
    { title: "Souvlaki Space Station", owned: true },
    { title: "When the Sun Hits", owned: true },
    { title: "Alison", owned: true },
    { title: "Sugar for the Pill", owned: false },
    { title: "40 Days", owned: true },
  ],
};
