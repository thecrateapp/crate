// Engineering blog calendar. Every written post launches together on LAUNCH_DATE; the
// series' chronology lives in each chapter and the timeline, not in publication dates.
// Proposed articles follow on Tuesdays.
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

export const LAUNCH_DATE = "2026-11-10";

export const calendar: CalendarEntry[] = [
  {
    slug: "crate-started-as-a-librarian",
    title: "Crate started as a librarian",
    problem:
      "The first Apply endpoint called a tag writer through the API's read-only music mount. Moving the write to a persisted worker task fixed execution but left partial results and playback-index reconciliation to handle.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "docs/technical/04-library-storage-sync-and-imports.md",
      "docs/technical/03-worker-tasks-and-background-services.md",
    ],
  },
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
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "docs/technical/smart-mix-design.md",
      "docs/technical/smart-mix-operations.md",
      "app/crate/smart_mix/planner.py",
    ],
  },
  {
    slug: "a-beat-grid-in-a-few-bytes",
    title: "A beat grid in two bytes per beat",
    problem:
      "A six-minute track has around 770 beats, and storing every timestamp as a float for every analysed track adds up in PostgreSQL.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "app/crate/smart_mix/beat_grid.py",
      "tools/crate-cli/src/mix_profile.rs",
    ],
  },
  {
    slug: "observing-a-home-server",
    title: "Observing a home server without a monitoring team",
    problem:
      "When a home server running a dozen containers gets slow, its owner has no on-call team and no time to learn a full monitoring stack.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "docs/technical/observability.md",
      "docs/technical/monitoring.md",
      "app/crate/observability",
    ],
  },
  {
    slug: "filesystem-to-indexed-catalogue",
    title: "When the filesystem stopped being the catalogue",
    problem:
      "Cold artist-page requests rebuilt the library inventory before pagination. A stored catalogue removed that work from browsing, then concurrent writers exposed the limits of the SQLite implementation.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "docs/technical/04-library-storage-sync-and-imports.md",
      "docs/technical/02-backend-api-and-data.md",
    ],
  },
  {
    slug: "reading-errors-without-trusting-them",
    title: "Reading production errors in Admin without trusting what they say",
    problem:
      "Sentry held 92 unresolved issues, most of them noise, and the errors that mattered carry library paths and text that a public repository and a model must not trust.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "docs/technical/observability.md",
      "docs/technical/evidence/observability/sentry-triage-2026-11.md",
      "app/crate/error_inbox",
      "app/crate/llm/prompts/error_triage.py",
      ".github/workflows/error-autofix.yml",
    ],
  },
  {
    slug: "taking-playback-over-from-navidrome",
    title: "Taking playback over from Navidrome",
    problem:
      "Listen inherited local file paths and Navidrome song IDs in the same queue. Removing Navidrome meant giving playback Crate catalogue identities and replacing the media, account and listening-state integrations around them.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "docs/technical/09-playback-realtime-and-subsonic.md",
      "docs/technical/08-frontends-admin-and-listen.md",
      "docs/technical/listen-media-access.md",
    ],
  },
  {
    slug: "when-retries-repeat-a-download",
    title: "When retries repeat a finished download",
    problem:
      "The importer and filesystem watcher could process the same artist at once. An uncaught failure after transfer restarted the whole acquisition, so we changed the handoff and disabled retries for that actor.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "docs/technical/03-worker-tasks-and-background-services.md",
      "docs/technical/04-library-storage-sync-and-imports.md",
      "app/crate/worker_handlers/acquisition.py",
      "app/crate/library_watcher.py",
    ],
  },
  {
    slug: "finding-the-one",
    title: "Finding the one: where every bar starts",
    problem:
      "Smart Mix could align two beat grids while putting the transition on the wrong beat of the bar. We needed a better downbeat estimate and a way to reject unreliable anchors.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "app/crate/smart_mix/beat_model.py",
      "app/crate/smart_mix/phrase_grid.py",
      "tools/crate-cli/src/beat_tracking.rs",
      "docs/technical/smart-mix-operations.md",
      "tools/smart-mix-eval/structure",
    ],
  },
  {
    slug: "lyrics-as-labels",
    title: "Lyrics as labels: calibrating a voice detector without listening",
    problem:
      "Smart Mix needed to identify sung phrases before overlapping two tracks. Synced lyrics gave us a reference for comparing voice detectors and choosing a threshold without labelling every phrase by hand.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "app/crate/smart_mix/vocals.py",
      "app/crate/smart_mix/voice_model.py",
      "app/crate/smart_mix/models.py",
      "docs/technical/smart-mix-operations.md",
      "tools/smart-mix-eval/vocals",
    ],
  },
  {
    slug: "giving-every-album-a-stable-address",
    title: "Giving every album a stable address",
    problem:
      "Names kept changing the paths Crate depended on. Storage V2 separated metadata from file addresses, then catalogue identities made those references reusable.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "app/crate/storage_layout.py",
      "app/crate/storage_import.py",
      "app/crate/entity_ids.py",
      "app/crate/db/repositories/library_album_upserts.py",
      "app/crate/db/repositories/playlists_detail_reads.py",
      "docs/technical/04-library-storage-sync-and-imports.md",
    ],
  },
  {
    slug: "twenty-numbers-for-a-sound",
    title: "Twenty numbers that describe how a track sounds",
    problem:
      "Tags say what a track is called, not how it sounds, so recommendations built on tags keep suggesting the wrong records.",
    publishOn: "2026-12-15",
    status: "planned",
    sources: [
      "docs/technical/06-audio-analysis-similarity-and-discovery.md",
      "app/crate/bliss.py",
    ],
  },
  {
    slug: "one-library-more-than-one-listener",
    title: "One library, more than one listener",
    problem:
      "Login could distinguish Crate's users before the library could. We added personal collections, ownership checks and sessions we could revoke.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "docs/technical/07-auth-users-social-and-sessions.md",
      "app/crate/api/auth.py",
      "app/crate/api/me.py",
      "app/crate/api/playlists.py",
      "app/crate/db/queries/user_library_library.py",
      "app/crate/db/repositories/user_library_mutations.py",
      "app/crate/db/repositories/auth_sessions.py",
      "app/tests/test_user_library_queries.py",
      "app/tests/test_playlist_access.py",
    ],
  },
  {
    slug: "building-an-artist-page-when-the-providers-disagree",
    title: "Building an artist page when the providers disagree",
    problem:
      "Artist metadata arrives from providers with different fields, cache lifetimes and failure modes. Crate needs to combine their answers without erasing useful data or undoing an edit.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "app/crate/enrichment.py",
      "app/crate/db/repositories/library_enrichment_writes.py",
      "app/tests/test_enrichment.py",
    ],
  },
  {
    slug: "teaching-crate-to-listen",
    title: "Teaching Crate to listen to its own library",
    problem:
      "Crate could identify a recording before it could describe its sound. We added audio features and Bliss, then fixed what our models and Rust integration missed.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "docs/technical/06-audio-analysis-similarity-and-discovery.md",
      "app/crate/audio_analysis.py",
      "app/crate/bliss.py",
      "app/crate/crate_cli.py",
      "tools/crate-cli",
    ],
  },
  {
    slug: "giving-the-library-a-radio",
    title: "Giving the library a radio of its own",
    problem:
      "Artist Radio began with an average audio vector. We added several kinds of seed, listening history and queue refill to turn it into a listening session.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "app/crate/radio_engine.py",
      "app/crate/queue_engine.py",
      "app/crate/db/radio.py",
      "app/listen/src/lib/radio.ts",
    ],
  },
  {
    slug: "never-count-in-a-request",
    title: "Never count the whole library during a request",
    problem:
      "Stats screens that aggregate the whole library on demand turn every page load into a full table scan.",
    publishOn: "2027-01-05",
    status: "planned",
    sources: [
      "AGENTS.md",
      "docs/technical/02-backend-api-and-data.md",
      "docs/technical/listening-stats-projections.md",
    ],
  },
  {
    slug: "taking-crate-out-of-the-browser",
    title: "Taking Crate out of the browser",
    problem:
      "Bundling Listen for a phone broke its same-origin assumptions. We separated app and server, then made authentication and navigation follow that split.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "app/listen/capacitor.config.ts",
      "app/listen/src/lib/api.ts",
      "app/listen/src/lib/server-store.ts",
      "app/listen/src/lib/capacitor-runtime.ts",
      "app/listen/src/lib/capacitor-init.ts",
      "app/listen/src/lib/library-routes.ts",
      "app/listen/src/lib/server-store.test.ts",
      "app/listen/src/lib/capacitor-runtime.test.ts",
      "docs/technical/listen-media-access.md",
      "docs/technical/listen-native-auth-contract.md",
    ],
  },
  {
    slug: "music-paths",
    title: "Music Paths: finding a route from one song to another",
    problem:
      "Going from one record to a very different one in ten tracks, without a jarring jump, means searching the library for a route.",
    publishOn: "2027-01-12",
    status: "planned",
    sources: ["docs/technical/music-paths.md", "app/crate/music_paths.py"],
  },
  {
    slug: "giving-database-writes-a-transaction-boundary",
    title: "Giving database writes a transaction boundary",
    problem:
      "Our database helpers committed their own work. Passing a shared session let a library operation decide which writes should succeed or fail together.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "app/crate/db/tx.py",
      "app/crate/db/engine.py",
      "app/crate/db/init_db.py",
      "app/crate/db/migrations/versions/001_baseline.py",
      "app/tests/test_db_access_boundaries.py",
      "app/tests/test_orm_schema_contract.py",
    ],
  },
  {
    slug: "federation-without-a-centre",
    title: "Federation without a central server",
    problem:
      "Small Crate servers want to share catalogues and stream from each other without anyone running a hub they all trust.",
    publishOn: "2027-01-19",
    status: "planned",
    sources: [
      "docs/technical/federation-protocol.md",
      "docs/technical/federation-key-management.md",
      "app/crate/federation",
    ],
  },
  {
    slug: "building-a-route-through-the-music-collection",
    title: "Building a route through the music collection",
    problem:
      "A musical route needs more than nearby tracks. We built Music Paths around destinations, then fixed the anchors, artist credits and incomplete journeys.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "docs/technical/music-paths.md",
      "app/crate/music_paths.py",
      "app/crate/db/paths_path_builder.py",
      "app/crate/db/paths_scene.py",
      "app/crate/recommendation_policy.py",
      "app/crate/music_path_validation.py",
      "app/listen/src/pages/path-playback.ts",
      "docs/technical/evidence/recommendations-review/README.md",
    ],
  },
  {
    slug: "a-threat-model-for-a-home-server",
    title: "Writing a threat model for a home server",
    problem:
      "Opening a home server to other servers changes who can reach it, and that calls for a written review of what can go wrong.",
    publishOn: "2027-01-26",
    status: "planned",
    sources: ["docs/technical/federation-threat-model.md"],
  },
  {
    slug: "keeping-background-work-from-interrupting-playback",
    title: "Keeping background work from interrupting playback",
    problem:
      "Moving work into a queue did not stop it competing with playback. We split workers, removed hidden audio work from sync and taught maintenance when to wait.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "docs/technical/03-worker-tasks-and-background-services.md",
      "app/crate/resource_governor.py",
      "app/crate/actors.py",
      "app/crate/analysis_daemon.py",
      "app/crate/library_sync.py",
      "app/tests/test_resource_governor.py",
      "docker-compose.yaml",
    ],
  },
  {
    slug: "audio-urls-that-dont-leak",
    title: "Audio URLs that don't leak your session",
    problem:
      "Audio players and casting devices want a plain URL, and putting a session token in a URL is how sessions leak.",
    publishOn: "2027-02-02",
    status: "planned",
    sources: ["docs/technical/listen-media-access.md", "app/crate/api/auth.py"],
  },
  {
    slug: "bringing-purchased-music-into-a-shared-library",
    title: "Bringing purchased music into a shared library",
    problem:
      "Bandcamp imports gave Crate a way to track who contributed an album, reuse its existing importer, and decide what withdrawal should remove.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "docs/technical/05-enrichment-acquisition-and-integrations.md",
      "app/crate/bandcamp/collection_sync.py",
      "app/crate/bandcamp/downloads.py",
      "app/crate/worker_handlers/bandcamp.py",
      "app/crate/worker_handlers/contributions.py",
      "app/crate/db/repositories/library_contributions.py",
      "app/tests/test_bandcamp_integration.py",
    ],
  },
  {
    slug: "what-listen-keeps-offline",
    title: "What Listen keeps offline, and why",
    problem:
      "Phones lose the network on the underground and run out of storage at the worst moment, so Listen needs clear rules for what stays on the device.",
    publishOn: "2027-02-09",
    status: "planned",
    sources: ["docs/technical/listen-offline-runtime-policy.md"],
  },
  {
    slug: "keeping-the-music-playing-on-android",
    title: "Keeping the music playing when Android puts the screen to sleep",
    problem:
      "Android needed to own the audio and queue while Listen slept. Moving playback into Media3 also changed how the app reconnects and restores a lost session.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "app/listen/android/app/src/main/java/app/cratemusic/crate/CrateNativePlaybackService.java",
      "app/listen/android/app/src/main/java/app/cratemusic/crate/CrateNativePlaybackPlugin.java",
      "app/listen/android/app/src/main/java/app/cratemusic/crate/PlaybackCheckpointStore.java",
      "app/listen/android/app/src/main/java/app/cratemusic/crate/ResumeAuthorizationIntent.java",
      "app/listen/android/app/src/test/java/app/cratemusic/crate/PlaybackCheckpointStoreTest.java",
      "app/listen/android/app/src/test/java/app/cratemusic/crate/NativePlaybackContractTest.java",
      "app/listen/src/lib/android-native-engine.ts",
      "app/listen/src/contexts/use-native-playback-event-bridge.ts",
      "docs/technical/android-playback-resumption.md",
    ],
  },
  {
    slug: "an-agent-proposes-a-person-approves",
    title: "An MCP server where the agent proposes and a person approves",
    problem:
      "Letting an AI agent maintain a music library is useful until it deletes the wrong album.",
    publishOn: "2027-02-16",
    status: "planned",
    sources: ["docs/technical/11-crate-mcp.md", "app/crate/mcp"],
  },
  {
    slug: "a-desktop-app-has-a-life-outside-its-window",
    title: "A desktop app has a life outside its window",
    problem:
      "Crate reused Listen in Tauri, then had to define what close, media keys and login links meant when the window was hidden or still starting.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "app/listen-desktop/src/main.tsx",
      "app/listen-desktop/vite.config.ts",
      "app/listen-desktop/src/lib/tauri-init.ts",
      "app/listen-desktop/src-tauri/src/lib.rs",
      "app/listen-desktop/src-tauri/src/macos_media_controls.rs",
      "app/listen-desktop/src-tauri/src/linux_media_controls.rs",
      "app/listen-desktop/src-tauri/src/windows_media_controls.rs",
      "app/listen-desktop/src-tauri/src/secure_session.rs",
      "app/listen-desktop/src-tauri/tauri.conf.json",
      "app/listen/src/lib/server-store-native.test.ts",
      "docs/technical/tauri-desktop-support.md",
    ],
  },
  {
    slug: "llms-as-a-governed-resource",
    title: "Treating LLMs as a governed resource",
    problem:
      "Model calls are slow, paid and unpredictable, and a self-hosted app has no platform team to keep them in check.",
    publishOn: "2027-02-23",
    status: "planned",
    sources: ["docs/technical/ai-agents.md", "app/crate/ai"],
  },
  {
    slug: "taking-artwork-processing-out-of-http-requests",
    title: "Taking artwork processing out of HTTP requests",
    problem:
      "An album cover request could read audio, call a provider and resize an image. We moved that work into persistent variants and made a miss cheap to serve.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "docs/technical/artwork-delivery.md",
      "app/crate/artwork_materializer.py",
      "app/crate/artwork_variants.py",
      "app/crate/artwork_sources.py",
      "app/crate/api/artwork_delivery.py",
      "app/crate/worker_handlers/artwork.py",
      "app/tests/test_artwork_read_path_purity.py",
      "app/tests/test_artwork_materializer.py",
    ],
  },
  {
    slug: "one-install-command",
    title: "One install command",
    problem:
      "Self-hosted software loses most of its users between reading the README and getting the first page to load.",
    publishOn: "2027-03-02",
    status: "planned",
    sources: ["docs/technical/00-quickstart.md", "app/installer"],
  },
  {
    slug: "moving-playback-from-one-device-to-another",
    title: "Moving playback from one device to another",
    problem:
      "Crate Connect grew from saved queues and remote commands into a handoff protocol. The difficult part was deciding when the new player could take over.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "app/crate/api/connect.py",
      "app/crate/api/connect_ws.py",
      "app/crate/db/repositories/connect.py",
      "app/crate/db/repositories/connect_state.py",
      "app/crate/db/repositories/connect_ws_hub.py",
      "app/listen/src/contexts/use-player-connect-v2-sync.ts",
      "app/listen/src/hooks/crate-connect-ws-message-handler.ts",
      "app/tests/test_connect_commands.py",
      "app/tests/test_connect_ws_v2.py",
    ],
  },
  {
    slug: "image-first-deploys",
    title: "Image-first deploys with automatic rollback",
    problem:
      "Deploying a dozen containers by copying files to a server works until a half-finished deploy takes production down.",
    publishOn: "2027-03-09",
    status: "planned",
    sources: ["docs/technical/10-development-deployment-and-operations.md"],
  },
  {
    slug: "letting-another-crate-into-the-catalogue",
    title: "Letting another Crate into the catalogue",
    problem:
      "Federation made Crate separate a track's identity from its source, its availability and the owner's permission to serve or copy it.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "docs/technical/federation-overview.md",
      "docs/technical/federation-protocol.md",
      "docs/technical/federation-production-acceptance.md",
      "app/crate/federation/global_source_resolver.py",
      "app/crate/federation/authorization.py",
      "app/crate/worker_handlers/federation.py",
      "app/tests/test_federation_catalog_sync_resume.py",
    ],
  },
  {
    slug: "speaking-opensubsonic",
    title: "Speaking OpenSubsonic",
    problem:
      "People already have favourite Subsonic apps, and a new server that ignores them asks too much.",
    publishOn: "2027-03-16",
    status: "planned",
    sources: ["docs/technical/opensubsonic.md", "app/crate/api/subsonic"],
  },
  {
    slug: "from-crossfades-to-a-shared-mixing-engine",
    title: "From crossfades to a shared mixing engine",
    problem:
      "Android's fades could stall while the music kept playing. We moved gain curves into PCM, then gave both decks one output timeline.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "app/crate/smart_mix/analyzer.py",
      "app/crate/smart_mix/planner.py",
      "app/crate/db/jobs/analysis_storage.py",
      "app/listen/src/contexts/player-engine-adapter.ts",
      "app/listen/android/app/src/main/java/app/cratemusic/crate/NativeQueueState.java",
      "app/listen/android/app/src/main/java/app/cratemusic/crate/NativeMixAudioProcessor.java",
      "app/listen/android/app/src/main/java/app/cratemusic/crate/PcmBusMixer.java",
      "docs/technical/smart-mix-implementation-plan.md",
      "docs/technical/smart-mix-operations.md",
    ],
  },
  {
    slug: "album-zips-in-rust",
    title: "Album downloads from a Rust worker",
    problem:
      "Zipping a lossless album in Python blocks a worker for minutes and gives the user no progress and no way to cancel.",
    publishOn: "2027-03-23",
    status: "planned",
    sources: ["app/media-worker"],
  },
  {
    slug: "why-we-switched-jam-rooms-off",
    title: "Why we switched Jam Rooms off",
    problem:
      "A room could agree on the queue and still restart the song or play nothing. Jam Rooms exposed the gap between synchronizing state and synchronizing audio.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "docs/technical/jam-rooms-status.md",
      "app/listen/src/app-shell/feature-flags.ts",
      "app/listen/src/app-shell/route-table.tsx",
      "app/listen/src/hooks/use-jam-websocket.ts",
      "app/listen/src/contexts/use-jam-queue-session.ts",
      "app/crate/api/jam.py",
      "app/tests/test_jam_sync.py",
    ],
  },
  {
    slug: "why-crate-decks-forks-mixxx",
    title: "Why Crate Decks is a Mixxx fork",
    problem:
      "A DJ client built as a VirtualDJ plugin hits limits the plugin SDK will never lift.",
    publishOn: "2027-03-30",
    status: "planned",
    sources: ["docs/technical/crate-decks.md"],
  },
  {
    slug: "what-available-offline-had-to-mean",
    title: "What available offline had to mean",
    problem:
      "An offline badge was only useful if the file survived a restart and the player could find it. Crate had to make downloads, indexes and identity agree.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "app/listen/src/lib/offline.ts",
      "app/listen/src/lib/offline-native-assets.ts",
      "app/listen/src/lib/offline-storage.ts",
      "app/listen/src/lib/offline-web.ts",
      "app/listen/src/lib/offline-native.ts",
      "app/listen/src/lib/offline-identity.ts",
      "app/listen/src/lib/offline-scheduler.ts",
      "app/listen/src/app-shell/OfflineAccessRoute.tsx",
      "app/listen/src/contexts/use-auth-session.ts",
      "docs/technical/listen-offline-runtime-policy.md",
    ],
  },
  {
    slug: "giving-the-cast-receiver-the-queue",
    title: "Giving the Cast receiver the queue",
    problem:
      "A Cast receiver needed to keep playing after the phone left. Crate handed it a real queue and separated queue edits, playback state and media access.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "app/shared/cast/src/protocol.ts",
      "app/cast-receiver/src/caf-adapter.ts",
      "app/cast-receiver/src/receiver-session-runtime.ts",
      "app/cast-receiver/src/receiver-client.ts",
      "app/listen/src/lib/cast-sender.ts",
      "app/listen/src/lib/cast-session-client.ts",
      "app/crate/api/cast.py",
      "app/crate/db/repositories/cast_sessions.py",
      "app/tests/test_cast_sessions.py",
      "app/tests/test_cast_session_api.py",
      "docs/technical/ios-release-and-cast.md",
    ],
  },
  {
    slug: "making-crate-usable-from-someone-elses-music-player",
    title: "Making Crate usable from someone else's music player",
    problem:
      "An external player exposed assumptions Listen could hide. Crate needed a real OpenSubsonic contract for credentials, responses and playback state.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "docs/technical/opensubsonic.md",
      "app/crate/subsonic/auth.py",
      "app/crate/subsonic/protocol.py",
      "app/crate/subsonic/routes.py",
      "app/crate/subsonic/services/queues.py",
      "app/tests/subsonic/test_contract_fixtures.py",
      "app/tests/test_subsonic_queues.py",
    ],
  },
  {
    slug: "sharing-a-collection-without-giving-away-its-ownership",
    title: "Sharing a collection without giving away its ownership",
    problem:
      "Listen offered Edit on other people's playlists. Explicit viewer roles separated ownership, collaboration, following and copying.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "docs/technical/playlist-crate-collaboration.md",
      "app/crate/db/repositories/playlists_membership_reads.py",
      "app/crate/db/repositories/playlists_collaboration.py",
      "app/crate/db/repositories/playlists_library_reads.py",
      "app/crate/db/repositories/crates_collaboration.py",
      "app/crate/db/schema_sections/collaboration_v108.py",
      "app/listen/src/lib/collaboration-access.ts",
      "app/tests/test_playlist_access.py",
      "app/tests/test_collaboration_visibility_migration.py",
    ],
  },
  {
    slug: "making-listening-history-belong-to-crate",
    title: "Making listening history belong to Crate",
    problem:
      "Crate needed its own record of listening: events it could deduplicate, statistics it could rebuild, and scrobbles that could fail independently.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "docs/technical/listening-stats-projections.md",
      "app/crate/db/repositories/user_library_playback_writes.py",
      "app/crate/db/jobs/user_listening_projections.py",
      "app/crate/scrobble.py",
      "app/tests/test_user_listening_projections.py",
      "app/tests/test_scrobble_lastfm.py",
    ],
  },
  {
    slug: "from-tour-dates-to-a-show-people-can-share",
    title: "From tour dates to a show people can share",
    problem:
      "A concert needed an identity beyond its provider listing, so corrections, attendance and reminders could survive syncs and duplicate cleanup.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "app/crate/db/repositories/show_identities.py",
      "app/crate/db/repositories/show_consolidation.py",
      "app/crate/db/repositories/shows_attendance.py",
      "app/crate/db/repositories/shows_ticketmaster_upserts.py",
      "app/crate/db/queries/shows_shared.py",
      "app/tests/test_show_identity.py",
      "app/tests/test_show_migration.py",
    ],
  },
  {
    slug: "opening-crate-to-agents",
    title: "Opening Crate to agents",
    problem:
      "A remote agent needed more than API access. Crate added bounded diagnostics, delegated scopes, exact change plans and authority checks at worker execution.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "app/crate/mcp/server.py",
      "app/crate/mcp/schemas.py",
      "app/crate/mcp/contract.py",
      "app/crate/agent_access.py",
      "app/crate/agent_library_operations.py",
      "app/crate/db/repositories/agent_plans.py",
      "app/crate/db/repositories/agent_operation_jobs.py",
      "app/crate/db/repositories/agent_task_control.py",
      "app/tests/test_agent_plan_approvals.py",
      "docs/technical/crate-mcp.md",
      "docs/technical/crate-mcp-distribution.md",
    ],
  },
  {
    slug: "putting-model-calls-behind-one-runtime",
    title: "Putting model calls behind one runtime",
    problem:
      "Crate gave model calls pinned action profiles, conservative usage reservations and separate worker queues for interactive and batch inference.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "app/crate/ai/runtime.py",
      "app/crate/ai/configuration.py",
      "app/crate/ai/consumers.py",
      "app/crate/ai/transport.py",
      "app/crate/ai/queues.py",
      "app/crate/ai/requeue.py",
      "app/crate/ai/guard.py",
      "app/crate/db/repositories/ai_usage.py",
      "app/tests/test_ai_runtime.py",
      "app/tests/test_ai_consumer_authority.py",
      "app/tests/test_ai_architecture.py",
      "docs/technical/ai-agents.md",
    ],
  },
  {
    slug: "building-an-installer-for-someone-elses-server",
    title: "Building an installer for someone else's server",
    problem:
      "Starting containers left too much configuration unfinished. Crate gained a guided installer with provider checks, preserved secrets and a shared MCP workflow.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "docs/plans/2026-10-26-crate-installer.md",
      "deploy/install/integrations.yaml",
      "app/installer/internal/manifest/manifest_test.go",
      "app/installer/internal/install/env.go",
      "app/installer/internal/envfile/envfile.go",
      "app/installer/internal/stack/stack.go",
      "app/installer/internal/validate/probes.go",
      "app/installer/internal/copilot/portal.go",
      "app/installer/internal/install/config_test.go",
    ],
  },
  {
    slug: "making-two-apps-look-and-behave-like-one-crate",
    title: "Making two apps look and behave like one Crate",
    problem:
      "Admin and Listen needed different workflows and the same UI foundations. Sharing components led to build fixes, behaviour contracts and one V3 identity.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "app/shared/ui/package.json",
      "app/shared/ui/domain/auth/OAuthButtons.tsx",
      "app/shared/ui/lib/crate-identity.ts",
      "app/shared/ui/lib/interface-preferences.ts",
      "app/shared/ui/lib/crate-identity.test.ts",
      "app/shared/ui/primitives/FormField.tsx",
      "app/shared/ui/primitives/FormField.test.tsx",
      "app/shared/ui/primitives/AppModal.test.tsx",
      "app/shared/ui/export-usage-policy.test.ts",
      "app/shared/ui/design-token-policy.test.ts",
      "tools/crate-ui-showcase/README.md",
      "docs/plans/2026-10-14-crate-v3-design-system.md",
    ],
  },
  {
    slug: "when-a-familiar-radio-became-too-familiar",
    title: "When a familiar radio became too familiar",
    problem:
      "Radio needed to remember listening without mistaking a delivered queue for a played one. We added song families, bounded rotation and separate session memory.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "app/crate/radio_engine.py",
      "app/crate/recommendation_policy.py",
      "app/crate/track_versions.py",
      "app/crate/db/queries/recommendation_history.py",
      "app/crate/radio_continuation.py",
      "app/tests/test_radio_session_rotation.py",
      "app/tests/test_radio_delivery_memory.py",
      "app/tests/test_radio_final_rotation.py",
      "docs/technical/evidence/radio/rotation-review.md",
    ],
  },
  {
    slug: "taking-the-library-into-virtualdj",
    title: "Taking the library into VirtualDJ",
    problem:
      "Crate became a native VirtualDJ source. Host probes changed media tickets, search cancellation and how Smart Mix could feed the queue without mixing audio.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "tools/vdj-plugin/src/sdk/online_source_plugin.cpp",
      "tools/vdj-plugin/src/online_source/online_source.cpp",
      "tools/vdj-plugin/include/crate_vdj/request_coordinator.hpp",
      "tools/vdj-plugin/src/core/connection_session.cpp",
      "tools/vdj-plugin/src/client/capability_client.cpp",
      "tools/vdj-plugin/src/client/stream_resolver.cpp",
      "tools/vdj-plugin/src/client/media_access_client.cpp",
      "tools/vdj-plugin/src/automix/play_events.cpp",
      "tools/vdj-plugin/tests/online_source/online_source_test.cpp",
      "app/crate/api/vdj_catalog.py",
      "app/crate/media_access.py",
      "app/tests/test_vdj_media_contract.py",
      "app/tests/test_vdj_feature_gates.py",
      "docs/technical/smart-mix-design.md",
      "docs/technical/smart-mix-implementation-plan.md",
    ],
  },
  {
    slug: "deploying-a-version-we-can-identify-and-recover",
    title: "Deploying a version we can identify and recover",
    problem:
      "Crate's deployment grew from pulling containers into a versioned release, with immutable image digests, preflight checks and state-aware recovery.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "docs/technical/deployment-profiles.md",
      "scripts/release_manifest.py",
      "scripts/deploy.sh",
      "scripts/deploy-remote.sh",
      "scripts/worker_queue_contract.py",
      "app/tests/test_release_manifest.py",
      "app/tests/test_deploy_release_commands.py",
    ],
  },
  {
    slug: "giving-smart-mix-a-sense-of-musical-structure",
    title: "Giving Smart Mix a sense of musical structure",
    problem:
      "BPM and cue points were not enough. Smart Mix 3 adds phrases, voice and energy to planning, while keeping a deterministic fallback and bounded model choices.",
    publishOn: "2026-11-10",
    status: "published",
    sources: [
      "app/crate/smart_mix/structure.py",
      "app/crate/smart_mix/beat_model.py",
      "app/crate/smart_mix/candidates.py",
      "app/crate/smart_mix/refinement.py",
      "app/crate/smart_mix/versions.py",
      "app/crate/db/repositories/smart_mix_signals.py",
      "app/tests/test_smart_mix_candidates.py",
      "docs/technical/smart-mix-operations.md",
      "tools/smart-mix-eval/README.md",
    ],
  },
];
