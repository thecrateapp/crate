export interface EngineeringMilestone {
  id: string;
  date: string;
  era: string;
  title: string;
  shortTitle?: string;
  summary: string;
  change: string;
  chapter?: number;
  href?: string;
  status: "draft" | "available" | "planned";
  source: string;
  systems: string[];
}

export const seriesTitle =
  "How to forget Spotify. Building Crate from the ground.";
export const timelineAsOf = "2026-11-07";

// Dates use the recorded commit's local calendar date, not a plan or publication date.
// Every source pins the historical change to its full commit SHA.
// Systems group responsibilities inside Crate; they are not deployment topology.
// A related article may cover a later implementation than the milestone it accompanies.
// Article status is independent from implementation, release and deployment status.
export const milestones: EngineeringMilestone[] = [
  {
    id: "librarian",
    date: "2026-03-19",
    era: "Starting the library",
    title: "A librarian for the collection",
    shortTitle: "The librarian",
    summary:
      "Inspect folders, match releases and repair files shared with other music services.",
    change:
      "A React interface, FastAPI API and Python worker enter the repository together. Navidrome still handles playback.",
    chapter: 1,
    href: "/blog/crate-started-as-a-librarian",
    status: "available",
    source:
      "https://github.com/thecrateapp/crate/commit/211f715c1404f083b7812acad584d4b552d3e2bc",
    systems: ["library", "workers"],
  },
  {
    id: "catalog",
    date: "2026-03-20",
    era: "Starting the library",
    title: "The filesystem gets a SQLite index",
    shortTitle: "A SQLite index",
    summary:
      "Library tables give browsing a stored view of artists, albums and tracks.",
    change:
      "A filesystem watcher updates the index when files change. Browsing can read the catalogue instead of walking the collection for every cold request.",
    chapter: 2,
    href: "/blog/filesystem-to-indexed-catalogue",
    status: "draft",
    source:
      "https://github.com/thecrateapp/crate/commit/a3d670457ecd67c27afb42c8b1155d068de7a663",
    systems: ["library", "catalog", "workers"],
  },
  {
    id: "sqlite-contention",
    date: "2026-03-20",
    era: "Starting the library",
    title: "Concurrent jobs hit SQLite locks",
    shortTitle: "SQLite contention",
    summary: "Sync and analytics need to write to the same database.",
    change:
      "The worker serialises selected database-heavy tasks and requeues those that must wait. The process-local gate reduces overlap, but other writers can still bypass it.",
    chapter: 2,
    href: "/blog/filesystem-to-indexed-catalogue",
    status: "draft",
    source:
      "https://github.com/thecrateapp/crate/commit/16c7bd88a97021b32e30129ee2a84015dba3ce8e",
    systems: ["library", "catalog", "workers"],
  },
  {
    id: "postgresql",
    date: "2026-03-20",
    era: "Starting the library",
    title: "PostgreSQL replaces SQLite",
    shortTitle: "PostgreSQL",
    summary: "The growing library and its background jobs move to PostgreSQL.",
    change:
      "The database changes on the same day the catalogue index arrives. The API and worker now share a PostgreSQL store rather than the original SQLite database.",
    chapter: 2,
    href: "/blog/filesystem-to-indexed-catalogue",
    status: "draft",
    source:
      "https://github.com/thecrateapp/crate/commit/93764ac35ce2e39b5cd05393647da8409342d207",
    systems: ["library", "catalog", "workers"],
  },
  {
    id: "worker-writes",
    date: "2026-03-20",
    era: "Starting the library",
    title: "The Apply button queues a repair",
    shortTitle: "Writes move to workers",
    summary:
      "Tag writes move out of the API and into the process with a writable music mount.",
    change:
      "The endpoint returns a task ID. The browser follows the job, while per-file errors and interrupted repairs still need explicit handling.",
    chapter: 1,
    href: "/blog/crate-started-as-a-librarian",
    status: "available",
    source:
      "https://github.com/thecrateapp/crate/commit/971d50b779dd8bf1197939ee47642327de5f5df1",
    systems: ["library", "catalog", "workers"],
  },
  {
    id: "direct-streaming",
    date: "2026-03-21",
    era: "Starting the library",
    title: "A local file can play without Navidrome",
    shortTitle: "Direct file streaming",
    summary: "Crate adds a direct-file fallback before Listen exists.",
    change:
      "The Admin player can request a library path from Crate or a song ID through the Navidrome proxy. The new route serves original audio files; catalogue and account integrations still depend on Navidrome.",
    chapter: 3,
    href: "/blog/taking-playback-over-from-navidrome",
    status: "draft",
    source:
      "https://github.com/thecrateapp/crate/commit/d50ce855be0fb8aec7edeceddb37ce340697e07b",
    systems: ["library", "catalog", "workers"],
  },
  {
    id: "bliss",
    date: "2026-03-21",
    era: "Starting the library",
    title: "Similarity starts with the audio",
    shortTitle: "Bliss vectors",
    summary:
      "A Rust Bliss tool extracts vectors that can be compared across tracks.",
    change:
      "Python invokes the native analyser and stores its results. Crate gains an acoustic signal for similarity alongside metadata and artist relationships.",
    chapter: 6,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/9965019bf70a70051961b6ca3fc34daab755fd09",
    systems: ["library", "catalog", "workers", "intelligence"],
  },
  {
    id: "crate-cli",
    date: "2026-03-27",
    era: "Starting the library",
    title: "Audio tools become crate-cli",
    shortTitle: "The Rust CLI",
    summary: "Scanning, analysis and Bliss commands share one Rust executable.",
    change:
      "The CLI gives Python a common native tool for file and audio work. It predates the separate Rust service that will later build download packages.",
    chapter: 6,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/ccc85bcc0f8acb588a4fc115362b3e873e9ef39a",
    systems: ["library", "catalog", "workers", "intelligence"],
  },
  {
    id: "dramatiq",
    date: "2026-03-28",
    era: "Owning playback",
    title: "Dramatiq replaces the task orchestrator",
    shortTitle: "Dramatiq and Redis",
    summary:
      "Task execution moves from the custom orchestrator to Dramatiq and Redis.",
    change:
      "The broker handles dispatch while Crate keeps its task records and domain handlers. Retry behaviour now matters to every operation that changes files.",
    chapter: 7,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/eff1f0815de2dd5080735f1c9d420f88a7c7a084",
    systems: ["library", "catalog", "workers", "intelligence"],
  },
  {
    id: "listen",
    date: "2026-03-28",
    era: "Owning playback",
    title: "Listen gets its own app",
    shortTitle: "Listen begins",
    summary: "Listening and library administration become separate interfaces.",
    change:
      "The first Listen scaffold adds a consumer PWA alongside Admin. Its player and browsing flows can develop separately from library maintenance.",
    chapter: 3,
    href: "/blog/taking-playback-over-from-navidrome",
    status: "draft",
    source:
      "https://github.com/thecrateapp/crate/commit/7b2c3de786ded7a9e203ee9dabccf0cc6fdcee3d",
    systems: ["library", "catalog", "workers", "intelligence"],
  },
  {
    id: "analysis-daemons",
    date: "2026-03-31",
    era: "Owning playback",
    title: "Audio analysis moves into daemons",
    shortTitle: "Analysis daemons",
    summary:
      "Long-running analysis no longer uses the same task shape as ordinary background jobs.",
    change:
      "Dedicated daemons take over audio analysis and Bliss work from Dramatiq tasks. The platform now has both queued operations and continuous workers.",
    chapter: 7,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/13bc989f4949d2048d9df928ad597ef4a70462ef",
    systems: ["library", "catalog", "workers", "intelligence"],
  },
  {
    id: "catalogue-streaming",
    date: "2026-04-06",
    era: "Owning playback",
    title: "A catalogue track ID becomes a stream URL",
    shortTitle: "Catalogue IDs play",
    summary: "Listen can request audio using Crate's own track identity.",
    change:
      "The stream endpoint looks up the library track's stored path and delegates file delivery. Listen prefers libraryTrackId while older path and Navidrome branches remain during the transition.",
    chapter: 3,
    href: "/blog/taking-playback-over-from-navidrome",
    status: "draft",
    source:
      "https://github.com/thecrateapp/crate/commit/1a4b5b9c8ade4be636acf33c99b71b04970057a1",
    systems: ["library", "catalog", "workers", "intelligence"],
  },
  {
    id: "acquisition-retries",
    date: "2026-04-10",
    era: "Owning playback",
    title: "A retry repeats a finished download",
    shortTitle: "The download race",
    summary:
      "A watcher moves files while an acquisition task is still trying to index them.",
    change:
      "The fix marks artists as processing, coordinates post-download work and disables retries for the whole download task. A later indexing failure must not restart acquisition.",
    chapter: 4,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/1f9bd46b46256da7091ffe2a541d7a39ba37f2f4",
    systems: ["library", "catalog", "workers", "intelligence"],
  },
  {
    id: "playback",
    date: "2026-04-11",
    era: "Owning playback",
    title: "Crate takes over playback",
    shortTitle: "Playback ownership",
    summary:
      "Navidrome leaves the runtime and its legacy integration is removed.",
    change:
      "Crate now owns the path from catalogue to stream. Playback joins the responsibilities already held by library repair and acquisition.",
    chapter: 3,
    href: "/blog/taking-playback-over-from-navidrome",
    status: "draft",
    source:
      "https://github.com/thecrateapp/crate/commit/3341893453af7312b2735211577c6d5fcbdf6217",
    systems: ["library", "catalog", "playback", "workers", "intelligence"],
  },
  {
    id: "storage",
    date: "2026-04-13",
    era: "Owning playback",
    title: "Identity survives a folder move",
    shortTitle: "Storage V2",
    summary: "Storage V2 separates library identities from readable paths.",
    change:
      "The migration gives the collection stable identifiers and reconciles existing files. AudioMuse also leaves the stack as Crate takes on its analysis work.",
    chapter: 5,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/647a1d6164abf37cce5b2c8debea9547f32d8778",
    systems: ["library", "catalog", "playback", "workers", "intelligence"],
  },
  {
    id: "database-boundary",
    date: "2026-04-19",
    era: "Building the product",
    title: "Database access gets a boundary",
    shortTitle: "The database boundary",
    summary:
      "SQL moves out of request handlers and into a dedicated database layer.",
    change:
      "Repositories, queries and explicit transaction scopes organise data access. Alembic joins the migration path; the same iteration also advances offline playback.",
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/8a71ad52360a18fff4e05cf7a9738a52b96a8e4b",
    systems: ["library", "catalog", "playback", "workers", "intelligence"],
  },
  {
    id: "shared-ui",
    date: "2026-04-22",
    era: "Building the product",
    title: "Admin and Listen share UI primitives",
    shortTitle: "Shared UI",
    summary:
      "The @crate/ui package gives the two applications common components.",
    change:
      "Shared controls and styling can change in one place. Admin and Listen retain separate applications and domain workflows.",
    chapter: 14,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/bfbae59e05e5ec459b58eb7df0ea03a78f5c3b29",
    systems: ["library", "catalog", "playback", "workers", "intelligence"],
  },
  {
    id: "music-paths",
    date: "2026-04-22",
    era: "Building the product",
    title: "Music Paths plans an acoustic route",
    shortTitle: "Music Paths",
    summary:
      "A route planner connects tracks through their acoustic relationships.",
    change:
      "The backend turns similarity into a sequence through the collection. Later revisions add artist affinity and genre signals to the route scoring.",
    chapter: 6,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/06af0101d0c5daf0e4fd7d86a0a1a1268c8aed7f",
    systems: ["library", "catalog", "playback", "workers", "intelligence"],
  },
  {
    id: "snapshots",
    date: "2026-04-24",
    era: "Building the product",
    title: "Prepare the screen before the request",
    shortTitle: "Snapshots",
    summary:
      "Snapshots and a projector move repeated work out of interactive reads.",
    change:
      "Persisted surfaces give the UI prepared data. A later Go service will serve selected hot routes, while Python keeps ownership of their construction.",
    chapter: 8,
    href: "/blog/reads-from-snapshots",
    status: "available",
    source:
      "https://github.com/thecrateapp/crate/commit/8224a3d74563a9f4b17766df0e45e729e928ce2f",
    systems: [
      "library",
      "catalog",
      "playback",
      "workers",
      "snapshots",
      "intelligence",
    ],
  },
  {
    id: "governor",
    date: "2026-05-04",
    era: "Sharing the machine",
    title: "Background jobs can wait for capacity",
    shortTitle: "Resource governor",
    summary:
      "A governor checks whether the host can afford more expensive work.",
    change:
      "Analysis, maintenance and playback share a machine. The governor defers eligible background work when resource or listener limits are reached.",
    chapter: 7,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/09da2273585ff35ad63451544d6672d7848c1454",
    systems: [
      "library",
      "catalog",
      "playback",
      "workers",
      "snapshots",
      "intelligence",
    ],
  },
  {
    id: "readplane",
    date: "2026-05-06",
    era: "Sharing the machine",
    title: "Go and Rust take on specific services",
    shortTitle: "Go reads, Rust packages",
    summary: "A Go read plane and Rust media worker join the runtime.",
    change:
      "Go starts with a small set of read routes and a FastAPI fallback. Rust builds download packages. Python continues to own writes and snapshot generation.",
    chapter: 8,
    href: "/blog/reads-from-snapshots",
    status: "available",
    source:
      "https://github.com/thecrateapp/crate/commit/1cc547459ea592c8fe13ee7d706a20415829af45",
    systems: [
      "library",
      "catalog",
      "playback",
      "workers",
      "snapshots",
      "intelligence",
    ],
  },
  {
    id: "android-player",
    date: "2026-05-09",
    era: "Sharing the machine",
    title: "Android gets a native playback engine",
    shortTitle: "Native Android audio",
    summary:
      "Audio playback gains an Android implementation outside the WebView.",
    change:
      "The native engine gives the mobile app a separate playback runtime. Queue coordination, interruptions and background behaviour need contracts across the JavaScript boundary.",
    chapter: 10,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/e7380245bb62dca1a038de0002705c0769909a59",
    systems: [
      "library",
      "catalog",
      "playback",
      "workers",
      "snapshots",
      "native",
      "intelligence",
    ],
  },
  {
    id: "desktop",
    date: "2026-05-14",
    era: "Sharing the machine",
    title: "Listen reaches the desktop",
    shortTitle: "Tauri desktop",
    summary: "A Tauri shell brings the listening app outside the browser tab.",
    change:
      "The first desktop app adds another runtime to support. Device integration and background playback continue to evolve after this scaffold.",
    chapter: 10,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/24ac33f72edc3058da0be5fbd1dafd80dcf672be",
    systems: [
      "library",
      "catalog",
      "playback",
      "workers",
      "snapshots",
      "native",
      "intelligence",
    ],
  },
  {
    id: "connect",
    date: "2026-05-30",
    era: "Sharing the machine",
    title: "Crate Connect links listening devices",
    shortTitle: "Crate Connect",
    summary: "Connected players become part of a shared listening session.",
    change:
      "The first Connect implementation adds device state and playback control. Later handoff work must reconcile which device owns the session.",
    chapter: 10,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/f61a5b11367c1ee79433e97ba4f6063919b623c5",
    systems: [
      "library",
      "catalog",
      "playback",
      "workers",
      "snapshots",
      "native",
      "intelligence",
    ],
  },
  {
    id: "crate-v2",
    date: "2026-06-13",
    era: "Sharing the machine",
    title: "A second pass at Listen and Admin",
    shortTitle: "Crate V2",
    summary:
      "The V2 iteration revisits the two applications after their first months of growth.",
    change:
      "The combined refactor changes product surfaces and their supporting backend. The separate listening and administration apps remain part of the architecture.",
    chapter: 14,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/9088e5802227a2e096a28478e4c7b0951efc608f",
    systems: [
      "library",
      "catalog",
      "playback",
      "workers",
      "snapshots",
      "native",
      "intelligence",
    ],
  },
  {
    id: "federation",
    date: "2026-07-24",
    era: "Across devices and servers",
    title: "Music crosses a server boundary",
    shortTitle: "Federation",
    summary:
      "Federation connects catalogues while playback remains subject to grants and tickets.",
    change:
      "This integration brings the federated network onto main. Remote discovery, authorisation and streaming span two owners; a catalogue entry alone does not grant access to audio.",
    chapter: 9,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/d626453e2acc8960301481bd4949d29885cd7ad4",
    systems: [
      "library",
      "catalog",
      "playback",
      "workers",
      "snapshots",
      "native",
      "federation",
      "intelligence",
    ],
  },
  {
    id: "smart-mix-planner",
    date: "2026-07-30",
    era: "Across devices and servers",
    title: "Transitions get a server-side plan",
    shortTitle: "Smart Mix planning",
    summary:
      "The first deterministic planner turns track profiles into a transition.",
    change:
      "The July implementation computes cues and transition parameters in the backend. Integration and device validation continue later; this date records the planner code.",
    chapter: 15,
    href: "/blog/smart-mix-planned-on-the-server",
    status: "available",
    source:
      "https://github.com/thecrateapp/crate/commit/24a1ad098a5784d9bc0600c9cf7c85064d3c5619",
    systems: [
      "library",
      "catalog",
      "playback",
      "workers",
      "snapshots",
      "native",
      "federation",
      "intelligence",
    ],
  },
  {
    id: "offline-integrity",
    date: "2026-09-12",
    era: "Across devices and servers",
    title: "An empty download cannot count as offline",
    shortTitle: "Offline integrity",
    summary:
      "Native integrity checks reject zero-byte files and wait for the asset index to persist.",
    change:
      "An interrupted download could leave an empty file that passed validation. The fix checks for real content and awaits index writes so completed files remain discoverable after restart.",
    chapter: 11,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/1085da4ea843b3fa1ec44f96f77cc405dc0ad7b5",
    systems: [
      "library",
      "catalog",
      "playback",
      "workers",
      "snapshots",
      "native",
      "federation",
      "intelligence",
    ],
  },
  {
    id: "cast-queue",
    date: "2026-09-15",
    era: "Across devices and servers",
    title: "The Cast receiver owns its queue",
    shortTitle: "Cast queue authority",
    summary:
      "Queue authority moves into the receiver running on the playback device.",
    change:
      "The sender coordinates with the receiver instead of owning every playback step. Reconnection must recover the receiver's current queue rather than overwrite it.",
    chapter: 12,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/75cf968fd7bfcf22d7e4dc01535f0f9752acb6d6",
    systems: [
      "library",
      "catalog",
      "playback",
      "workers",
      "snapshots",
      "native",
      "federation",
      "intelligence",
    ],
  },
  {
    id: "opensubsonic",
    date: "2026-09-17",
    era: "Across devices and servers",
    title: "OpenSubsonic gets an interoperability gate",
    shortTitle: "OpenSubsonic",
    summary: "Protocol behaviour is checked against clients outside Crate.",
    change:
      "The compatibility work covers authentication, catalogue responses and media delivery. An explicit interoperability gate checks the contract beyond individual endpoints.",
    chapter: 12,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/32eeb7b6d8f45cb02d3160c702904fdbd09f95a2",
    systems: [
      "library",
      "catalog",
      "playback",
      "workers",
      "snapshots",
      "native",
      "federation",
      "intelligence",
    ],
  },
  {
    id: "listening-projections",
    date: "2026-10-08",
    era: "Measuring and automating",
    title: "Listening stats rebuild only changed days",
    shortTitle: "Listening projections",
    summary:
      "Dirty-day projections replace repeated reconstruction of listening history.",
    change:
      "Background work refreshes the affected daily aggregates. Stats reads use the projections, while unchanged days avoid another rebuild.",
    chapter: 13,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/cbfd4403722dd97a4a80ca60960193708637ffb8",
    systems: [
      "library",
      "catalog",
      "playback",
      "workers",
      "snapshots",
      "native",
      "federation",
      "intelligence",
    ],
  },
  {
    id: "mcp-maintenance",
    date: "2026-10-16",
    era: "Measuring and automating",
    title: "MCP uses the existing repair workflow",
    shortTitle: "MCP maintenance",
    summary:
      "Agents gain bounded library operations through shared plans and workers.",
    change:
      "Metadata repair, enrichment, analysis and sync use the same execution model as Admin. Plans retain identity and authority checks when the worker applies their effects.",
    chapter: 17,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/7af26ed54dacaa2c994e078d7e68066d7a5ad80e",
    systems: [
      "library",
      "catalog",
      "playback",
      "workers",
      "snapshots",
      "native",
      "federation",
      "intelligence",
    ],
  },
  {
    id: "ai-budgets",
    date: "2026-10-19",
    era: "Measuring and automating",
    title: "Model calls get admission and budgets",
    shortTitle: "AI admission",
    summary:
      "AI calls use a pinned configuration and reserve capacity before contacting a provider.",
    change:
      "The runtime checks concurrent calls and daily allowances. It records usage against the accepted configuration, including cases where a provider leaves usage unknown.",
    chapter: 17,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/af03f5fb3028bc5298e0b984e9952ca32fa4fe6a",
    systems: [
      "library",
      "catalog",
      "playback",
      "workers",
      "snapshots",
      "native",
      "federation",
      "intelligence",
    ],
  },
  {
    id: "crate-v3",
    date: "2026-10-28",
    era: "Measuring and automating",
    title: "One identity for Crate 3",
    shortTitle: "Crate 3.0",
    summary:
      "Listen and Admin share a visual system. A Go installer and optional operator tools arrive.",
    change:
      "The V3 merge brings shared controls and expanded listening stats. Agent and Operator remain opt-in capabilities with different permissions.",
    chapter: 14,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/82ea84746f62f0c6052fdd5fdcf84dbb092c130b",
    systems: [
      "library",
      "catalog",
      "playback",
      "workers",
      "snapshots",
      "native",
      "federation",
      "intelligence",
    ],
  },
  {
    id: "observability",
    date: "2026-11-01",
    era: "Operating the platform",
    title: "Missing metrics stay visibly missing",
    shortTitle: "Persistent metrics",
    summary: "Application metrics survive beyond the live Redis buffers.",
    change:
      "Minute buckets preserve readings and collection gaps. System Health can distinguish partial or stale evidence from a measured zero.",
    chapter: 19,
    href: "/blog/observing-a-home-server",
    status: "available",
    source:
      "https://github.com/thecrateapp/crate/commit/55fc5eddcbc3b1da0bbaa0935eb11ec2d416bf8f",
    systems: [
      "library",
      "catalog",
      "playback",
      "workers",
      "snapshots",
      "native",
      "federation",
      "intelligence",
    ],
  },
  {
    id: "analyzer-v6",
    date: "2026-11-03",
    era: "Operating the platform",
    title: "The analyser stops mistaking bass for key",
    shortTitle: "Analysis quality",
    summary: "Analyzer v6 corrects key detection and stabilises tempo grids.",
    change:
      "The evaluation compares its output with agreed Mixxx references. Stricter quality labels leave fewer profiles marked full; the old profiles remain readable until reanalysis.",
    chapter: 16,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/cb50d79ed7b9a4cfdd4fcb2b0211a9c35cdc194d",
    systems: [
      "library",
      "catalog",
      "playback",
      "workers",
      "snapshots",
      "native",
      "federation",
      "intelligence",
    ],
  },
  {
    id: "ai-queues",
    date: "2026-11-04",
    era: "Operating the platform",
    title: "Interactive AI and bulk work get separate queues",
    shortTitle: "AI queues",
    summary: "Model tasks move into dedicated ai and ai_bulk worker pools.",
    change:
      "Long batches no longer occupy the same pool as interactive AI work. Provider concurrency limits still apply above those queues.",
    chapter: 17,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/6fc8eb67a3a14deeda0936f5e0475849cd78983c",
    systems: [
      "library",
      "catalog",
      "playback",
      "workers",
      "snapshots",
      "native",
      "federation",
      "intelligence",
    ],
  },
  {
    id: "v3-2-4",
    date: "2026-11-05",
    era: "Operating the platform",
    title: "Crate 3.2.4 restores macOS packages",
    shortTitle: "Crate 3.2.4",
    summary:
      "A shell compatibility fix restores the desktop artifacts missing from 3.2.3.",
    change:
      "The symbol-upload step now works with the older shell on the macOS build machines. The server is unchanged from 3.2.3, with no database migration.",
    chapter: 18,
    status: "planned",
    source:
      "https://github.com/thecrateapp/crate/commit/988597d04cce19364ce8378eebcc712aa16c20c7",
    systems: [
      "library",
      "catalog",
      "playback",
      "workers",
      "snapshots",
      "native",
      "federation",
      "intelligence",
    ],
  },
  {
    id: "smart-mix-3",
    date: "2026-11-06",
    era: "Operating the platform",
    title: "Smart Mix 3 reaches main",
    shortTitle: "Smart Mix 3",
    summary:
      "A new analysis stack and transition work land after the latest version tag.",
    change:
      "Beat grids, structure and energy feed transition planning. This milestone records integration into main; production deployment was not checked.",
    chapter: 15,
    href: "/blog/smart-mix-planned-on-the-server",
    status: "available",
    source:
      "https://github.com/thecrateapp/crate/commit/d0316e5a1f70939e74555b279fca3c4496ceae6f",
    systems: [
      "library",
      "catalog",
      "playback",
      "workers",
      "snapshots",
      "native",
      "federation",
      "intelligence",
    ],
  },
];
