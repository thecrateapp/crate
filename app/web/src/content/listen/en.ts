import { t } from "../../i18n";
import type { Feature, Status, Step } from "../../lib/chapters";

export interface SmartMixItem {
  name: string;
  meta: string;
  body: string;
  facts: string[];
}

export interface SmartMixFigure {
  value: string;
  unit?: string;
  label: string;
}

export interface SmartMixPlatform {
  name: string;
  status: Status;
  body: string;
}

export interface SmartMixControl {
  name: string;
  control: "switch" | "range";
  value: string;
  body: string;
}

export interface SmartMixSection {
  eyebrow: string;
  title: string;
}

export interface SmartMixDetail {
  techniques: SmartMixSection & { items: SmartMixItem[] };
  stages: Step[];
  decide: SmartMixSection & { items: SmartMixItem[] };
  numbers: SmartMixSection & { figures: SmartMixFigure[]; note: string };
  platforms: SmartMixSection & { items: SmartMixPlatform[]; note: string };
  controls: SmartMixSection & { items: SmartMixControl[]; note: string };
}

export interface ListenChapter {
  title: string;
  id?: string;
  lede: string[];
  status?: "in-development";
  features?: Feature[];
  dive?: { name: "radio" | "paths"; steps: Step[] };
  smartMix?: SmartMixDetail;
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
    title: "Listen · Crate",
    description:
      "Gapless playback, Smart Mix with beatmatched transitions on Android, Radio and Paths built on audio analysis, offline mirrors, federation and apps for desktop, Android and the web.",
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
          body: "Albums play gapless, track into track. Between other tracks on the web and desktop, Smart transitions take your crossfade, from 0 to 12 s, and shorten it to 2, 4 or 6 s from a similarity score: sound, BPM, key, energy, danceability and valence. On Android, Smart Mix goes further.",
          link: { href: "#smart-mix", label: "Smart Mix" },
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
      title: "Smart Mix",
      id: "smart-mix",
      lede: [
        "Not a crossfade. A planned transition.",
        "Your server measures every track and plans every handoff. Android plays it locked to the beat.",
      ],
      smartMix: {
        techniques: {
          eyebrow: "Three techniques",
          title: "The planner picks one for every transition, and records why.",
          items: [
            {
              name: "Gapless",
              meta: "Inside an album",
              body: "Track runs into track with no gap and no fade, the way the record was sequenced.",
              facts: ["within albums", "no fade"],
            },
            {
              name: "Adaptive blend",
              meta: "Whenever beatmatch is not safe",
              body: "An equal-power crossfade. The incoming track is matched to the loudness of the outgoing outro, and the cut lands on a beat whenever the grid allows it.",
              facts: ["equal power", "±6 dB match", "≤ −1 dBTP"],
            },
            {
              name: "Beatmatch + Bass swap",
              meta: "When both beats are confident",
              body: "Tempo and phase locked. The next track starts on the beat of the one playing, at its tempo, then eases back to its own. At the midpoint the low end changes hands, so two basslines never pile up.",
              facts: ["±4% tempo", "≥ 2 bars", "150 Hz swap"],
            },
          ],
        },
        stages: [
          {
            title: "Lock",
            body: "B pre-rolls muted for 2.5 s at A's tempo and starts on an exact audio frame. It has to land within ±10 ms, or the mix carries on as a plain crossfade.",
          },
          {
            title: "Blend",
            body: "Equal-power curves cross at 50%. Gain is only ever turned down, never above 0 dB.",
          },
          {
            title: "Bass swap",
            body: "A 150 Hz low shelf cuts up to −24 dB on one track at a time. The lows change hands at the midpoint, over 1/8 of the mix.",
          },
          {
            title: "Release",
            body: "A is gone. B eases back to its own tempo over 4 s.",
          },
        ],
        decide: {
          eyebrow: "How it decides",
          title: "Analysis, planner, engine.",
          items: [
            {
              name: "Analysis",
              meta: "Offline, for every track",
              body: "A Rust analyzer on your server measures tempo, its confidence and stability, a beat grid refined to about 1 ms, downbeats and time signature; key, scale and Camelot code; intro and outro cues with their own local tempo, beats and downbeat; EBU R128 loudness, with 5 s windows at the cues, and true peak; energy, danceability and valence; and where the audio really starts and ends.",
              facts: [
                "onset detection",
                "tempogram",
                "dynamic-programming beat tracker",
                "chroma key profiles",
              ],
            },
            {
              name: "Planner",
              meta: "On the server, for every pair",
              body: "It chooses gapless, adaptive or beatmatch. Beatmatch needs beat references on both cues, high confidence, stable cues, the same time signature, a tempo change within 4% (half and double tempo count) and at least 2 bars of overlap. Anything less becomes an adaptive blend, with the reason recorded. Cuts snap to beats, the phase offset is computed, and gain is matched to the outgoing outro within ±6 dB, capped so the combined true peak stays at or below −1 dBTP. Its ranking of what mixes well next weighs tempo, Camelot key, energy, danceability, sound, valence and genre.",
              facts: ["1–12 s", "handoff at 50%", "fallback reason recorded"],
            },
            {
              name: "Engine",
              meta: "On Android, in real time",
              body: "Both tracks are mixed on one shared 48 kHz stereo bus in 10 ms blocks. Tempo moves within 0.94–1.06, fades follow cos/sin curves and gain is only ever reduced. It keeps mixing with the screen off, in Doze and when the server is unreachable.",
              facts: ["48 kHz", "10 ms blocks", "0.94–1.06"],
            },
          ],
        },
        numbers: {
          eyebrow: "Measured",
          title: "On a phone, on the app's own audio bus.",
          figures: [
            { value: "3.0", unit: "ms", label: "Beat alignment, p95" },
            { value: "7.4", unit: "ms", label: "p95 in Doze, the worst case" },
            { value: "0", label: "Underruns, and no clipping" },
            {
              value: "76.4",
              unit: "%",
              label: "Tracks with BPM within ±4%, on a 360-track set",
            },
            { value: "0.8", unit: "s", label: "Rust analysis of a 30 s clip" },
            { value: "7.9", unit: "MB", label: "Memory for the same clip" },
          ],
          note: "Xiaomi 13. Target: 20 ms. p95 with the screen off and with the server unreachable: 6.0 ms; on test fixtures: 7, 6, 6 and 12 ms. Essentia, on the same 360 tracks: 56.9%. The previous Python analysis took 26.3 s and 359 MB for the same clip.",
        },
        platforms: {
          eyebrow: "Where it plays",
          title: "Shipped on Android.",
          items: [
            {
              name: "Android",
              status: "available",
              body: "Smart Mix, Beatmatch and Bass swap.",
            },
            {
              name: "Web and desktop",
              status: "available",
              body: "Smart transitions: your crossfade, shortened to 2, 4 or 6 s by how well the tracks match. Albums stay gapless.",
            },
            {
              name: "iOS",
              status: "planned",
              body: "Smart Mix on iPhone.",
            },
            {
              name: "VirtualDJ",
              status: "in-development",
              body: "The Decks plugin: Crate as an online source.",
            },
          ],
          note: "Off by default. Server operators opt in with environment variables: CRATE_SMART_MIX_ENABLED, plus one each for Android crossfade, Beatmatch and Bass swap.",
        },
        controls: {
          eyebrow: "Your controls",
          title: "Four settings.",
          items: [
            {
              name: "Smart Mix",
              control: "switch",
              value: "On",
              body: "Planned transitions, on or off.",
            },
            {
              name: "Maximum transition",
              control: "range",
              value: "6 s",
              body: "From 0 to 12 s. 6 s by default.",
            },
            {
              name: "Beatmatch",
              control: "switch",
              value: "On",
              body: "Lock tempo and phase when the planner allows it.",
            },
            {
              name: "Bass swap",
              control: "switch",
              value: "On",
              body: "Swap the lows at the midpoint. Requires Beatmatch.",
            },
          ],
          note: "Albums always stay gapless.",
        },
      },
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
            body: "Each candidate gets a weighted score. Discovery Radio: sound 0.34, artists 0.22, genre 0.16, BPM 0.09, energy 0.08, Camelot 0.05 and era 0.03, minus penalties. Seeded radios weigh artists and genre above sound.",
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
          status: "in-development",
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
          body: "A signed Android app, with Smart Mix: beatmatched transitions and bass swap.",
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
          body: "Use a Subsonic client if you prefer. Feishin, Symfonium and Subtracks are being validated.",
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
          body: "Upcoming shows near you, from Ticketmaster and Setlist.fm.",
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
      status: "in-development",
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
