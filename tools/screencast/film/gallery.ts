import type { App } from "./apps";

export interface Frame {
  take: string;
  at: number;
}

export interface GalleryShot {
  id: string;
  app: App;
  title: string;
  caption: string;
  alt: string;
  desktop: Frame;
  mobile: Frame;
}

const CAPTIONS: Record<string, string> = {
  "listen/home":
    "Your library opens on a featured artist, what you played last and what just arrived.",
  "listen/artist":
    "Every artist has a page with photo, biography, albums and singles, and their own radio.",
  "listen/album":
    "Albums play in their original quality, with format, tempo and key on every track.",
  "listen/player":
    "The full-screen player follows the queue and shows the analysis of what is playing.",
  "listen/lyrics": "Lyrics scroll in sync with the music, line by line.",
  "listen/equalizer":
    "A smart equalizer tunes itself to the genre of each track.",
  "listen/crates":
    "Crates keep albums in order, like records in a box you flip through.",
  "listen/crates-index":
    "Your Crates and the ones you follow, public or private.",
  "listen/playlist":
    "Playlists mix tracks from the whole library, analysed and lossless.",
  "listen/explore":
    "Explore genre rooms, new arrivals and stations built from your own library.",
  "listen/search": "Search finds artists, albums and tracks as you type.",
  "listen/radar":
    "Radar follows upcoming releases and shows from the artists you follow.",
  "listen/paths":
    "Paths trace a route between two artists through similar sound.",
  "listen/stats":
    "Stats show what you listened to, when, and your artist of the period.",
  "listen/digging":
    "Crate Digging turns your listening into a story you can share.",
  "admin/dashboard": "The dashboard shows what the server is doing right now.",
  "admin/tasks":
    "Every background task in its queue, with its progress as it runs.",
  "admin/browse":
    "Browse the whole catalogue by genre, country, decade and format.",
  "admin/artist":
    "Artists arrive enriched with biography, tags, listeners and popularity.",
  "admin/album":
    "Each album is analysed: tempo, key, loudness, mood and audio features.",
  "admin/library-health":
    "Health checks find problems in the library and offer the fix.",
  "admin/acquisition":
    "Search Tidal and Soulseek together and pick the release to bring in.",
  "admin/downloads":
    "Downloads from Tidal and Soulseek move through the import queue.",
  "admin/release-radar":
    "New releases from your artists, waiting for a decision.",
  "admin/system-playlists":
    "Editorial playlists generated for Listen, with their own rules.",
  "admin/agents":
    "Connected AI agents and exactly what they are allowed to do.",
  "admin/system":
    "Runtime health of the whole stack: latency, errors, cache and load.",
  "admin/stack":
    "Every service of the stack running, with logs and restarts at hand.",
};

const shot = (
  app: App,
  id: string,
  title: string,
  alt: string,
  desktop: Frame,
  mobile: Frame = desktop,
): GalleryShot => ({
  id,
  app,
  title,
  caption: CAPTIONS[`${app}/${id}`] ?? "",
  alt,
  desktop,
  mobile,
});

const end = (take: string): Frame => ({ take, at: 60 });

export const GALLERY: GalleryShot[] = [
  shot(
    "listen",
    "home",
    "Home",
    "Listen home with the featured artist on desktop and phone",
    end("home-hero"),
  ),
  shot(
    "listen",
    "artist",
    "Artists",
    "Artist page with photo, biography and discography",
    { take: "artist", at: 0.5 },
  ),
  shot(
    "listen",
    "album",
    "Albums",
    "Album page playing in FLAC with its tracklist",
    { take: "album", at: 3 },
  ),
  shot(
    "listen",
    "player",
    "Player",
    "Full-screen player with the queue and track analysis",
    { take: "player", at: 5 },
  ),
  shot(
    "listen",
    "lyrics",
    "Synced lyrics",
    "Player following synced lyrics line by line",
    { take: "lyrics", at: 10 },
  ),
  shot(
    "listen",
    "equalizer",
    "Equalizer",
    "Player with the equalizer open",
    end("equalizer"),
  ),
  shot(
    "listen",
    "crates",
    "Crates",
    "A Crate's cover flow of numbered records",
    { take: "crates", at: 3.3 },
    end("crates"),
  ),
  shot(
    "listen",
    "crates-index",
    "Your Crates",
    "Your Crates collection",
    end("crates-index"),
  ),
  shot(
    "listen",
    "playlist",
    "Playlists",
    "A playlist with analysed FLAC tracks",
    end("playlists"),
  ),
  shot(
    "listen",
    "explore",
    "Explore",
    "Explore with genre rooms and new arrivals",
    end("explore"),
  ),
  shot(
    "listen",
    "search",
    "Search",
    "Instant search across artists, albums and tracks",
    end("search"),
  ),
  shot(
    "listen",
    "radar",
    "Radar",
    "Radar with upcoming releases and shows",
    end("radar"),
  ),
  shot(
    "listen",
    "paths",
    "Paths",
    "A music path between two artists",
    end("paths"),
  ),
  shot(
    "listen",
    "stats",
    "Stats",
    "Listening stats with the artist of the period",
    end("stats"),
  ),
  shot(
    "listen",
    "digging",
    "Crate Digging",
    "A shareable story of your listening",
    end("digging"),
  ),
  shot(
    "admin",
    "dashboard",
    "Dashboard",
    "Admin dashboard with work in progress",
    end("health"),
  ),
  shot(
    "admin",
    "tasks",
    "Tasks",
    "Worker queues running enrichment and analysis",
    end("enrichment"),
  ),
  shot(
    "admin",
    "browse",
    "Browse",
    "Browse every artist in the library",
    end("browse"),
  ),
  shot(
    "admin",
    "artist",
    "Artist",
    "Enriched artist with biography, tags and listeners",
    { take: "analysis", at: 0.6 },
  ),
  shot(
    "admin",
    "album",
    "Audio analysis",
    "Album analysis with tempo, key, mood and features",
    end("album"),
  ),
  shot(
    "admin",
    "library-health",
    "Library health",
    "Problems found in the library and how to fix them",
    end("library-health"),
  ),
  shot(
    "admin",
    "acquisition",
    "Acquisition",
    "Search Tidal and Soulseek together",
    end("acquisition"),
    end("imports"),
  ),
  shot(
    "admin",
    "downloads",
    "Downloads",
    "Active downloads from Tidal and Soulseek",
    end("imports"),
  ),
  shot(
    "admin",
    "release-radar",
    "Release radar",
    "New releases waiting for a decision",
    end("release-radar"),
  ),
  shot(
    "admin",
    "system-playlists",
    "System playlists",
    "Editorial playlists generated for Listen",
    end("system-playlists"),
  ),
  shot(
    "admin",
    "agents",
    "Agents",
    "Connected agents and their access",
    end("agents"),
  ),
  shot(
    "admin",
    "system",
    "System health",
    "Runtime health of the whole stack",
    end("stats"),
  ),
  shot(
    "admin",
    "stack",
    "Stack",
    "Every service of the stack running",
    end("stack"),
  ),
];

export function galleryErrors(gallery: GalleryShot[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const entry of gallery) {
    const key = `${entry.app}/${entry.id}`;
    if (ids.has(key)) errors.push(`${key} is listed twice`);
    ids.add(key);
    if (!entry.title.trim()) errors.push(`${key} has no title`);
    if (entry.caption.trim().length < 20) errors.push(`${key} needs a caption`);
    if (entry.alt.trim().length < 12)
      errors.push(`${key} needs a descriptive alt text`);
  }
  return errors;
}

export function galleryTakes(gallery: GalleryShot[]): string[] {
  const keys = gallery.flatMap((entry) => [
    `${entry.app}/${entry.desktop.take}/desktop`,
    `${entry.app}/${entry.mobile.take}/mobile`,
  ]);
  return [...new Set(keys)].sort();
}
