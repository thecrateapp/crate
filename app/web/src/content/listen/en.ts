import { t } from "../../i18n";
import type { Feature, Step } from "../../lib/chapters";

export interface ListenChapter {
  title: string;
  lede: string[];
  status?: "coming-soon";
  features?: Feature[];
  dive?: { name: "radio" | "paths"; steps: Step[] };
}

export interface ListenPage {
  meta: { title: string; description: string };
  eyebrow: string;
  title: string;
  lede: string;
  chapters: ListenChapter[];
}

export const listen: ListenPage = {
  meta: {
    title: "Listen — Crate",
    description:
      "Gapless playback, Radio and Paths built on audio analysis, offline mirrors, federation and apps for desktop, Android and the web.",
  },
  eyebrow: "Listen",
  title: "Play what you own.",
  lede: "Crate plays your library on the web, on desktop and on Android. Radio and Paths choose tracks by how they sound, measured from your own files.",
  chapters: [
    {
      title: "Play",
      lede: ["Gapless albums. Transitions that know the music."],
      features: [
        {
          title: "Gapless and smart transitions",
          body: "Albums play gapless, track into track. Between other tracks, the crossfade length comes from BPM, key and energy.",
        },
        {
          title: "Smart Mix on Android",
          body: "The server plans every transition: intro and outro cue points found automatically, a beat grid, Camelot compatibility and BS.1770 loudness. The Android player runs an equal-power fade across two decks, from 0 to 12 seconds. Planning never blocks playback, and there is an offline fallback.",
        },
        {
          title: "Equalizer",
          body: "10 bands and 21 presets, with adaptive EQ per track.",
        },
        {
          title: "Smart EQ",
          body: "The curve comes from a chain: your preset, the curator's track setting, the curator's album setting, the genre (inherited from its parent genres), a curve derived from analysis, then flat. The player shows which one applies and why.",
        },
        {
          title: "Lyrics and visuals",
          body: "Synced lyrics with tap-to-seek, and a WebGL visualizer.",
        },
      ],
    },
    {
      title: "Radio",
      lede: [
        "Pick a seed. Radio keeps choosing by sound.",
        "Seed it with an artist, album, track, playlist, Crate or genre, or start Discovery Radio.",
      ],
      dive: {
        name: "radio",
        steps: [
          {
            title: "Seed",
            body: "Every analysed track has a bliss vector: 20 numbers that describe how it sounds. The seed becomes a target point in that space.",
          },
          {
            title: "Neighbours",
            body: "pgvector finds the tracks nearest to the target.",
          },
          {
            title: "Score",
            body: "Each candidate gets a weighted score: sound 0.34, artists 0.22, genre 0.16, BPM 0.09, energy 0.08, Camelot 0.05 and era 0.03, minus penalties.",
          },
          {
            title: "Queue",
            body: "Artist spacing and deduplication shape the queue.",
          },
          {
            title: "Feedback",
            body: "Each like moves the target 8%, up to 40%. A dislike excludes its neighbours. Feedback is saved.",
          },
        ],
      },
    },
    {
      title: "Paths",
      lede: [
        "Choose where to start and where to end. Crate plans the route between them.",
      ],
      dive: {
        name: "paths",
        steps: [
          {
            title: "Endpoints",
            body: "Start and end can each be a track, an album, an artist or a genre. A path runs from 5 to 50 steps.",
          },
          {
            title: "Genre map",
            body: "The first planner takes the shortest route over the genre map. Parent, child and influence links cost 1.0, fusion 1.6, related 2.5.",
          },
          {
            title: "Scenes and sound",
            body: "The second planner follows artist scenes. The third draws a line through bliss space.",
          },
          {
            title: "Keep it",
            body: "Paths can get an optional LLM review; bring your own model. They are saved and can be regenerated.",
          },
        ],
      },
    },
    {
      title: "Discover",
      lede: ["Ways into the library that start from the music."],
      features: [
        {
          title: "Explore",
          body: "One place to start: moods, eras, genres and the playlists your curators publish.",
        },
        {
          title: "Moods",
          body: "Eight moods, from energetic to acoustic, derived from audio analysis of your library.",
        },
        {
          title: "Time tunnels",
          body: "Jump into eras of your library with enough depth to wander.",
        },
        {
          title: "Genre rooms",
          body: "Start from a scene, then let Crate lead you sideways.",
        },
        {
          title: "Radar",
          body: "Upcoming shows, new releases and pre-releases from the artists you follow.",
        },
      ],
    },
    {
      title: "Yours",
      lede: ["Your listening stays on your server, and comes back to you."],
      features: [
        {
          title: "Stats",
          body: "From the last week to all time: a listening heatmap, your sound profile, and Replay mixes you can play.",
        },
        {
          title: "Crate Digging",
          body: "Your listening as a story, chapter by chapter, ready to share.",
        },
        {
          title: "Crates",
          body: "Albums you want to keep together. Share them, curate them with others, download them as a ZIP.",
        },
        {
          title: "Collaborative playlists",
          body: "Playlists that several people edit.",
        },
        {
          title: "Smart playlists",
          body: "Curators build smart playlists in the admin app and publish them to the whole server.",
        },
      ],
    },
    {
      title: "Together",
      lede: [
        "A Crate server is a small community. Federation connects it to others.",
      ],
      features: [
        {
          title: "Follow",
          body: "Follow people on your server and open their public profiles.",
        },
        {
          title: "Affinity",
          body: "See how your listening overlaps with someone else's, and why you match.",
        },
        {
          title: "Shared Crates and playlists",
          body: "Share Crates and playlists with the people on your server.",
        },
        {
          title: "Federation",
          body: "Pair your server with other Crate servers. Every server signs with its own Ed25519 identity, pairings need approval, and playback from a paired server is relayed through yours.",
        },
        {
          title: "Jams",
          body: "Rooms with one shared queue and votes.",
          status: "coming-soon",
          link: { href: "/developers#working-on", label: t("working.link") },
        },
      ],
    },
    {
      title: "Everywhere",
      lede: ["One library on every screen you use."],
      features: [
        {
          title: "Desktop",
          body: "Apps for macOS, Windows and Linux with native media controls.",
        },
        {
          title: "Android",
          body: "A signed Android app, with Smart Mix transitions.",
        },
        {
          title: "Web",
          body: "Listen installs as a PWA, including on iPhone from Safari.",
        },
        {
          title: "Offline",
          body: "Keep a local mirror of tracks, albums and static playlists. The player prefers the mirrored copy and keeps playing when the network drops.",
        },
        {
          title: "Cast",
          body: "Send playback to Google Cast devices.",
        },
        {
          title: "More than one server",
          body: "The native apps connect to several Crate servers.",
        },
        {
          title: "OpenSubsonic",
          body: "Use a Subsonic client if you prefer. Tested with Feishin, Symfonium and Subtracks.",
        },
        {
          title: "Languages and scrobbling",
          body: "Seven languages. Scrobbling to Last.fm and ListenBrainz.",
        },
      ],
    },
    {
      title: "Live",
      lede: ["From your library to the venue and back."],
      features: [
        {
          title: "Shows",
          body: "Upcoming shows near you, from Ticketmaster and Last.fm.",
        },
        {
          title: "Probable setlists",
          body: "Setlists from Setlist.fm, playable from the tracks already in your library.",
        },
        {
          title: "Bandcamp",
          body: "Sync your Bandcamp purchases and see your contributions to the artists you support.",
        },
      ],
    },
    {
      title: "Decks",
      status: "coming-soon",
      lede: ["Crate as an online source in VirtualDJ."],
      features: [
        {
          title: "VirtualDJ plugin",
          body: "In development.",
          link: { href: "/developers#working-on", label: t("working.link") },
        },
      ],
    },
  ],
};
