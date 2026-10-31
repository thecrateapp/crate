import type { ChapterContent, PageIntro } from "../../lib/chapters";

export interface AdminPage extends PageIntro {
  chapters: ChapterContent[];
}

export const admin: AdminPage = {
  meta: {
    title: "Admin · Crate",
    description:
      "Library health checks, staged imports, acquisition, enrichment, a signed genre taxonomy, analysis coverage, live operations, and opt-in AI agents over MCP and in Telegram for your Crate server.",
  },
  eyebrow: "Admin",
  title: "Keep the library in shape.",
  lede: "The admin app keeps a large library clean, complete and understood, and shows every task the server runs on its behalf.",
  chapters: [
    {
      title: "Health",
      lede: ["Find what is wrong before a listener does."],
      features: [
        {
          title: "17 checks",
          body: "Health checks the files and the catalog together: duplicate albums and tracks, orphaned and stale rows, folders that drift from the artist layout, files on disk that were never indexed.",
        },
        {
          title: "Risk levels",
          body: "Every fix carries a risk level. Risky fixes ask for confirmation before anything changes.",
        },
        {
          title: "Library Trash",
          body: "Files a fix removes are moved to Library Trash, a quarantine folder, instead of being deleted.",
        },
      ],
    },
    {
      title: "Imports",
      lede: ["New music arrives in stages, never straight into the library."],
      features: [
        {
          title: "Staged imports",
          body: "Downloads, uploads and Bandcamp purchases land in a staging area first. A worker normalises names and folders, resolves the artist and album, then moves the files into the library and queues enrichment and analysis.",
        },
        {
          title: "Watcher and scans",
          body: "A filesystem watcher keeps the catalog fresh. Full scans reconcile it with what is really on disk.",
        },
        {
          title: "Portable metadata",
          body: "Every album folder carries its metadata in .crate/album.json, so the catalog can be rebuilt from the files alone.",
        },
      ],
    },
    {
      title: "Acquisition",
      lede: ["Keep the discographies you care about complete."],
      features: [
        {
          title: "Discography monitoring",
          body: "Crate watches the artists in your library and lists the releases you do not have yet.",
        },
        {
          title: "New releases and pre-releases",
          body: "New releases show up as they appear. Pre-releases are fetched on release day.",
        },
        {
          title: "Quality",
          body: "Downloads are filtered by quality, and fake FLAC files, lossy audio in a lossless container, are detected.",
        },
        {
          title: "Optional integrations",
          body: "Tidal and Soulseek, through slskd, are optional integrations. Neither is active until you configure it.",
        },
      ],
    },
    {
      title: "Enrichment",
      lede: ["Names, images and context for every artist and album."],
      features: [
        {
          title: "Identity",
          body: "MusicBrainz anchors artists, albums and tracks to stable IDs. Wikidata and Wikipedia add context.",
        },
        {
          title: "Artists",
          body: "Last.fm and Discogs add biographies, tags and similar artists. Spotify adds popularity.",
        },
        {
          title: "Artwork",
          body: "Covers from Cover Art Archive, artist images from Fanart.tv, with Deezer and iTunes as fallbacks.",
        },
        {
          title: "Shows and lyrics",
          body: "Setlist.fm and Ticketmaster for live music, lrclib for synced lyrics.",
        },
        {
          title: "Bandcamp",
          body: "Links between Bandcamp and the catalog, so listeners can buy from the artists they play.",
        },
        {
          title: "Artist research",
          body: "Draft artist biographies from the sources above.",
          status: "optional-llm",
        },
      ],
    },
    {
      title: "Genres",
      lede: ["A genre map you can verify, and change."],
      features: [
        {
          title: "Taxonomy",
          body: "61 seeded genres connected by four relation types. Paths and Genre rooms are built on it.",
        },
        {
          title: "Signed releases",
          body: "Taxonomy updates ship as releases signed with ed25519, so a server can check where they came from.",
        },
        {
          title: "Local overrides",
          body: "Change any genre on your server. Your overrides sit on top of the signed release.",
        },
        {
          title: "Genre EQ",
          body: "Every genre can carry an EQ curve. Subgenres inherit it from their parents.",
        },
        {
          title: "Proposals and descriptions",
          body: "Suggest new genres and relations, and write genre descriptions.",
          status: "optional-llm",
        },
      ],
    },
    {
      title: "Analysis & Insights",
      lede: ["See how much of the library Crate understands."],
      features: [
        {
          title: "Coverage",
          body: "Track coverage for audio features, bliss vectors, fingerprints and Smart Mix profiles.",
        },
        {
          title: "Backfills you control",
          body: "The Smart Mix profile backfill can be paused, resumed and cancelled.",
        },
        {
          title: "Insights",
          body: "Charts of the library itself: BPM distribution, energy against danceability, albums by decade, artists by country, genre footprint.",
        },
      ],
    },
    {
      title: "Operations",
      lede: ["Everything the server does, in one place."],
      features: [
        {
          title: "Live tasks",
          body: "Every background task as it runs: queued, running, finished or failed, with progress.",
        },
        {
          title: "Roles and capabilities",
          body: "Role-based access control with fine-grained capabilities, enforced by Casbin.",
        },
        {
          title: "Invites and sessions",
          body: "Invite people to the server, see their sessions and revoke them.",
        },
        {
          title: "System",
          body: "System metrics, a view of the running stack and the service logs.",
        },
        {
          title: "Crate Agent and Crate Operator",
          body: "Look after the server from Telegram. Crate Agent diagnoses it with live evidence. Crate Operator also plans changes that run only after you approve them, and posts alerts for failed tasks, health and new releases.",
          status: "opt-in",
          link: { href: "#telegram-agent", label: "In Telegram" },
        },
        {
          title: "Language models",
          body: "Features marked like this one use a language model the operator sets up in Admin: Gemini, DeepSeek, or Ollama on your own hardware. Crate works fully without them.",
          status: "optional-llm",
        },
      ],
    },
    {
      title: "AI agents, via MCP",
      id: "mcp",
      status: "opt-in",
      lede: [
        "Let an AI agent look after your library.",
        "Over MCP, an agent such as Claude diagnoses the collection and prepares its maintenance. Nothing changes until a person approves it.",
      ],
    },
  ],
};
