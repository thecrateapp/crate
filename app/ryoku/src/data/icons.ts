// The icons a Crate for Ryoku desktop draws, as vector files beside this site. Most are
// copied unchanged from crate-icons' scalable/apps. Discord, Visual Studio Code and
// GitHub Desktop were not installed on the machine they came from, so they were drawn
// with crate-for-ryoku's build_icons.brand_svg from the same pinned Tabler set.
// Only Solar glyphs (CC BY 4.0) and brand marks (Tabler Icons, MIT; Simple Icons, CC0)
// are shown: a graded fallback is the app's own drawing, so it stays on the machine.
// No music-streaming services: Crate is the alternative to them.
export type IconKind = "solar" | "tabler" | "simple-icons";

export interface ShowcaseIcon {
  name: string;
  file: string;
  kind: IconKind;
}

const icon = (name: string, file: string, kind: IconKind): ShowcaseIcon => ({
  name,
  file: `/icons-showcase/${file}.svg`,
  kind,
});

// System glyphs and brand marks side by side, as they sit on the dock.
export const ICONS: ShowcaseIcon[] = [
  icon("Terminal", "utilities-terminal", "solar"),
  icon("Files", "org.gnome.Nautilus", "solar"),
  icon("Firefox", "firefox", "tabler"),
  icon("Discord", "discord", "tabler"),
  icon("Music", "org.gnome.Music", "solar"),
  icon("Obsidian", "obsidian", "simple-icons"),
  icon("Slack", "slack", "tabler"),
  icon("Calendar", "org.gnome.Calendar", "solar"),
  icon("Steam", "steam", "tabler"),
  icon("VS Code", "visual-studio-code", "tabler"),
  icon("Weather", "org.gnome.Weather", "solar"),
  icon("Telegram", "telegram", "tabler"),
  icon("Settings", "org.gnome.Settings", "solar"),
  icon("GitHub", "github-desktop", "tabler"),
  icon("Chrome", "google-chrome", "tabler"),
  icon("Text Editor", "org.gnome.TextEditor", "solar"),
  icon("System Monitor", "org.gnome.SystemMonitor", "solar"),
  icon("Image Viewer", "org.gnome.Loupe", "solar"),
];
