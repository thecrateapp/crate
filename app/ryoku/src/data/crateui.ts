// The Crate UI section: five rules Crate for Ryoku takes from Crate's design system,
// each shown with a small example built from the site's own Crate tokens.
export type CrateUIBlockId =
  | "accent"
  | "hairlines"
  | "type"
  | "glass"
  | "icons";

export interface CrateUIBlock {
  id: CrateUIBlockId;
  label: string;
  text: string;
  // an optional second line, quieter than the rule
  note?: string;
}

export const CRATE_UI_BLOCKS: CrateUIBlock[] = [
  {
    id: "accent",
    label: "One accent",
    text: "Brand cyan marks what is on and what you act on; everything else stays neutral, and amber only reports status.",
  },
  {
    id: "hairlines",
    label: "Hairlines, not boxes",
    text: "A group is a top rule and a mono header row, not a filled box.",
  },
  {
    id: "type",
    label: "Display and mono",
    text: "Bricolage Grotesque for names and numerals, JetBrains Mono for labels and readouts.",
  },
  {
    id: "glass",
    label: "One glass",
    text: "Every floating surface shares one frosted glass, a hairline edge and 6 px corners.",
  },
  {
    id: "icons",
    label: "Icons",
    text: "crate-icons draws the system apps as Solar glyphs, and crateize gives every app you install its brand mark or a glyph in the same ink.",
    note: "A brand with no free mark keeps its own icon in Crate's colours, a watcher redraws the set as apps come and go, and Papirus fills the rest.",
  },
];
