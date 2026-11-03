// Engineering blog calendar. One post a week, on Tuesdays, with a break over the holidays.
// Every post takes one engineering problem Crate had and explains how it was solved.
// Writing guide: docs/technical/engineering-blog.md. Validated by blog-calendar.test.ts.

export type PostStatus = "planned" | "drafting" | "review" | "published";

export interface CalendarEntry {
  slug: string;
  title: string;
  problem: string;
  publishOn: string;
  status: PostStatus;
  sources: string[];
}

export const calendar: CalendarEntry[] = [
  {
    slug: "reads-from-snapshots",
    title: "Serving hot screens from snapshots, not queries",
    problem:
      "Listen's busiest screens were computed in Python against PostgreSQL on every request, on a home server that also runs analysis and transcoding.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "app/readplane/README.md",
      "app/crate/projector.py",
      "docs/technical/01-system-overview.md",
    ],
  },
  {
    slug: "smart-mix-planned-on-the-server",
    title: "Planning DJ transitions on the server, playing them on a phone",
    problem:
      "A good transition needs beat grids, keys and loudness for both tracks, but the phone that plays it has a clock and little else.",
    publishOn: "2026-11-17",
    status: "planned",
    sources: [
      "docs/technical/smart-mix-design.md",
      "docs/technical/smart-mix-operations.md",
      "app/crate/smart_mix/planner.py",
    ],
  },
  {
    slug: "a-beat-grid-in-a-few-bytes",
    title: "A whole beat grid in a few hundred bytes",
    problem:
      "A six-minute track has around 800 beats; storing every timestamp as a float for every track in the library is wasteful to keep and slow to ship.",
    publishOn: "2026-11-24",
    status: "planned",
    sources: [
      "app/crate/smart_mix/beat_grid.py",
      "tools/crate-cli/src/mix_profile.rs",
    ],
  },
  {
    slug: "twenty-numbers-for-a-sound",
    title: "Twenty numbers that describe how a track sounds",
    problem:
      "Tags say what a track is called, not how it sounds, so recommendations built on tags keep suggesting the wrong records.",
    publishOn: "2026-12-01",
    status: "planned",
    sources: [
      "docs/technical/06-audio-analysis-similarity-and-discovery.md",
      "app/crate/bliss.py",
    ],
  },
  {
    slug: "never-count-in-a-request",
    title: "Never count the whole library during a request",
    problem:
      "Stats screens that aggregate the whole library on demand turn every page load into a full table scan.",
    publishOn: "2026-12-08",
    status: "planned",
    sources: [
      "AGENTS.md",
      "docs/technical/02-backend-api-and-data.md",
      "docs/technical/listening-stats-projections.md",
    ],
  },
  {
    slug: "music-paths",
    title: "Music Paths: finding a route from one song to another",
    problem:
      "Going from one record to a very different one in ten tracks, without a jarring jump, means searching the library for a route.",
    publishOn: "2026-12-15",
    status: "planned",
    sources: ["docs/technical/music-paths.md", "app/crate/music_paths.py"],
  },
  {
    slug: "federation-without-a-centre",
    title: "Federation without a central server",
    problem:
      "Small Crate servers want to share catalogues and stream from each other without anyone running a hub they all trust.",
    publishOn: "2027-01-05",
    status: "planned",
    sources: [
      "docs/technical/federation-protocol.md",
      "docs/technical/federation-key-management.md",
      "app/crate/federation",
    ],
  },
  {
    slug: "a-threat-model-for-a-home-server",
    title: "Writing a threat model for a home server",
    problem:
      "Opening a home server to other servers changes who can reach it, and that calls for a written review of what can go wrong.",
    publishOn: "2027-01-12",
    status: "planned",
    sources: ["docs/technical/federation-threat-model.md"],
  },
  {
    slug: "audio-urls-that-dont-leak",
    title: "Audio URLs that don't leak your session",
    problem:
      "Audio players and casting devices want a plain URL, and putting a session token in a URL is how sessions leak.",
    publishOn: "2027-01-19",
    status: "planned",
    sources: ["docs/technical/listen-media-access.md", "app/crate/api/auth.py"],
  },
  {
    slug: "what-listen-keeps-offline",
    title: "What Listen keeps offline, and why",
    problem:
      "Phones lose the network on the underground and run out of storage at the worst moment, so Listen needs clear rules for what stays on the device.",
    publishOn: "2027-01-26",
    status: "planned",
    sources: ["docs/technical/listen-offline-runtime-policy.md"],
  },
  {
    slug: "an-agent-proposes-a-person-approves",
    title: "An MCP server where the agent proposes and a person approves",
    problem:
      "Letting an AI agent maintain a music library is useful until it deletes the wrong album.",
    publishOn: "2027-02-02",
    status: "planned",
    sources: ["docs/technical/11-crate-mcp.md", "app/crate/mcp"],
  },
  {
    slug: "llms-as-a-governed-resource",
    title: "Treating LLMs as a governed resource",
    problem:
      "Model calls are slow, paid and unpredictable, and a self-hosted app has no platform team to keep them in check.",
    publishOn: "2027-02-09",
    status: "planned",
    sources: ["docs/technical/ai-agents.md", "app/crate/ai"],
  },
  {
    slug: "drawing-a-home-server-live",
    title: "Drawing a home server live",
    problem:
      "When a home server is slow, its owner needs to see which container is busy and who is playing without writing Prometheus queries.",
    publishOn: "2027-02-16",
    status: "planned",
    sources: [
      "docs/technical/observability.md",
      "docs/technical/monitoring.md",
    ],
  },
  {
    slug: "one-install-command",
    title: "One install command",
    problem:
      "Self-hosted software loses most of its users between reading the README and getting the first page to load.",
    publishOn: "2027-02-23",
    status: "planned",
    sources: ["docs/technical/00-quickstart.md", "app/installer"],
  },
  {
    slug: "image-first-deploys",
    title: "Image-first deploys with automatic rollback",
    problem:
      "Deploying a dozen containers by copying files to a server works until a half-finished deploy takes production down.",
    publishOn: "2027-03-02",
    status: "planned",
    sources: ["docs/technical/10-development-deployment-and-operations.md"],
  },
  {
    slug: "speaking-opensubsonic",
    title: "Speaking OpenSubsonic",
    problem:
      "People already have favourite Subsonic apps, and a new server that ignores them asks too much.",
    publishOn: "2027-03-09",
    status: "planned",
    sources: ["docs/technical/opensubsonic.md", "app/crate/api/subsonic"],
  },
  {
    slug: "album-zips-in-rust",
    title: "Album downloads from a Rust worker",
    problem:
      "Zipping a lossless album in Python blocks a worker for minutes and gives the user no progress and no way to cancel.",
    publishOn: "2027-03-16",
    status: "planned",
    sources: ["app/media-worker"],
  },
  {
    slug: "why-crate-decks-forks-mixxx",
    title: "Why Crate Decks is a Mixxx fork",
    problem:
      "A DJ client built as a VirtualDJ plugin hits limits the plugin SDK will never lift.",
    publishOn: "2027-03-23",
    status: "planned",
    sources: ["docs/technical/crate-decks.md"],
  },
];
