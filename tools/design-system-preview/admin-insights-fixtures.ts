import type { InsightsData } from "../../app/ui/src/pages/Insights";

const data: InsightsData = {
  countries: { Spain: 48, Germany: 26, "United Kingdom": 19 },
  bpm_distribution: [
    { bpm: "70–90", count: 18 },
    { bpm: "90–110", count: 24 },
    { bpm: "110–130", count: 13 },
  ],
  energy_danceability: [
    { x: 0.72, y: 0.38, artist: "Caspian", title: "Arcs of Command" },
    { x: 0.46, y: 0.51, artist: "Emma Ruth Rundle", title: "Marked for Death" },
  ],
  top_genres: [
    { genre: "post-metal", artists: 31, albums: 72 },
    { genre: "post-rock", artists: 28, albums: 68 },
    { genre: "hardcore", artists: 24, albums: 61 },
  ],
  popularity: [
    {
      artist: "Caspian",
      popularity: 78,
      popularity_score: 0.78,
      listeners: 82000,
      albums: 6,
    },
    {
      artist: "Emma Ruth Rundle",
      popularity: 66,
      popularity_score: 0.66,
      listeners: 66000,
      albums: 8,
    },
  ],
  albums_by_decade: { "2010s": 84, "2020s": 132 },
  top_albums: [
    {
      album: "Dust and Disquiet",
      artist: "Caspian",
      listeners: 26000,
      popularity: 71,
      popularity_score: 0.71,
      year: "2015",
    },
  ],
  acoustic_instrumental: [
    {
      x: 0.83,
      y: 0.91,
      artist: "Caspian",
      title: "Hymn for the Greatest Generation",
    },
  ],
  feature_coverage: [
    { feature: "BPM", value: 136400, total: 136442 },
    { feature: "Energy", value: 110000, total: 136442 },
  ],
  artist_depth: [
    {
      artist: "Caspian",
      popularity: 78,
      popularity_score: 0.78,
      listeners: 82000,
      albums: 6,
      tracks: 74,
    },
  ],
};

export function useApi<T>(_url: string | null) {
  return {
    data: data as T,
    loading: false,
    error: "Sample refresh unavailable",
    refetch: () => {},
  };
}
