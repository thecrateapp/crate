export const BANDS = [
  "31",
  "62",
  "125",
  "250",
  "500",
  "1k",
  "2k",
  "4k",
  "8k",
  "16k",
];

export interface Preset {
  id: string;
  label: string;
  gains: number[];
}

export const PRESETS: Preset[] = [
  { id: "flat", label: "Flat", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "bass", label: "Bass boost", gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { id: "vocal", label: "Vocal", gains: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1] },
  {
    id: "loudness",
    label: "Loudness",
    gains: [5, 4, 1, 0, -1, -1, 0, 1, 4, 5],
  },
];

/** Fired on document when a preset is chosen; detail is the gains. */
export const PRESET_EVENT = "crate:eq-preset";
/** Fired on document when a band is edited by hand. */
export const MANUAL_EVENT = "crate:eq-manual";
