import type { EffectiveEq } from "@/hooks/use-effective-eq";
import type { EqPresetName } from "@/lib/equalizer";

export const EQ_PRESET_LABEL_KEYS: Record<EqPresetName, string> = {
  flat: "player.equalizer.presets.flat",
  rock: "player.equalizer.presets.rock",
  pop: "player.equalizer.presets.pop",
  jazz: "player.equalizer.presets.jazz",
  classical: "player.equalizer.presets.classical",
  bass_boost: "player.equalizer.presets.bassBoost",
  treble_boost: "player.equalizer.presets.trebleBoost",
  vocal: "player.equalizer.presets.vocal",
  electronic: "player.equalizer.presets.electronic",
  acoustic: "player.equalizer.presets.acoustic",
  hip_hop: "player.equalizer.presets.hipHop",
  black_metal: "player.equalizer.presets.blackMetal",
  death_metal: "player.equalizer.presets.deathMetal",
  thrash: "player.equalizer.presets.thrash",
  doom: "player.equalizer.presets.doom",
  hardcore: "player.equalizer.presets.hardcore",
  punk: "player.equalizer.presets.punk",
  progressive: "player.equalizer.presets.progressive",
  shoegaze: "player.equalizer.presets.shoegaze",
  post_rock: "player.equalizer.presets.postRock",
  lo_fi: "player.equalizer.presets.loFi",
};

export const EQ_PRESET_LABEL_ENTRIES = Object.entries(EQ_PRESET_LABEL_KEYS) as [
  EqPresetName,
  string,
][];

export const SMART_EQ_CHAIN: readonly EffectiveEq["source"][] = [
  "user_track_preset",
  "instance_track_preset",
  "instance_album_preset",
  "genre_taxonomy_preset",
  "audio_analysis_preset",
  "flat",
];

export const SMART_EQ_SOURCE_LABEL_KEYS: Record<EffectiveEq["source"], string> =
  {
    user_track_preset: "player.equalizer.sources.userTrack",
    instance_track_preset: "player.equalizer.sources.curatorTrack",
    instance_album_preset: "player.equalizer.sources.curatorAlbum",
    genre_taxonomy_preset: "player.equalizer.sources.genreTaxonomy",
    audio_analysis_preset: "player.equalizer.sources.audioAnalysis",
    flat: "player.equalizer.sources.flat",
  };
