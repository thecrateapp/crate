import type { ChapterContent, PageIntro } from "../../lib/chapters";

export interface Endpoint {
  method: "GET" | "POST";
  path: string;
  body: string;
}

export interface Snippet {
  label: string;
  code: string;
}

export interface DocLink {
  title: string;
  href: string;
}

export interface DevelopersChapter extends ChapterContent {
  install?: true;
  snippets?: Snippet[];
  endpoints?: Endpoint[];
  links?: DocLink[];
}

export interface DevelopersPage extends PageIntro {
  chapters: DevelopersChapter[];
}

const DOCS = "https://docs.cratemusic.app";

export const developers: DevelopersPage = {
  meta: {
    title: "Developers — Crate",
    description:
      "Crate's REST and OpenSubsonic APIs, personal access tokens, Smart Mix endpoints, local development and how to contribute.",
  },
  eyebrow: "Developers",
  title: "Build on Crate.",
  lede: "The apps talk to Crate through the same APIs you can use. The whole stack runs on your machine with one command.",
  chapters: [
    {
      title: "APIs",
      lede: ["Everything the apps do, you can do too."],
      features: [
        {
          title: "REST and OpenAPI",
          body: "FastAPI publishes an OpenAPI schema, with interactive documentation at /docs on your server.",
        },
        {
          title: "OpenSubsonic",
          body: "/rest implements OpenSubsonic, pinned to API version 1.16.1: 50 operations, plus the formPost, indexBasedQueue, songLyrics (v1 and v2) and topSongsByArtistId extensions. Clients sign in with a per-user Subsonic API key, never the account password. sonicSimilarity is tracked in issue #290.",
        },
        {
          title: "Capabilities",
          body: "GET /api/capabilities tells a client what this server supports, and what the current token may do, before it asks.",
        },
      ],
      snippets: [
        {
          label: "Ask a server what it supports",
          code: 'curl \\\n  -H "Authorization: Bearer crv_xxxx" \\\n  https://your-server/api/capabilities',
        },
      ],
    },
    {
      title: "Tokens",
      lede: ["Personal access tokens for anything that is not a browser."],
      features: [
        {
          title: "Stored as digests",
          body: "Tokens start with crv_. The server keeps only their SHA-256 digest, never the token itself.",
        },
        {
          title: "Scopes",
          body: "Each token carries the scopes it needs: vdj.catalog.read, vdj.media.read, vdj.smart_mix.read and vdj.play_events.write.",
        },
        {
          title: "Allowlist",
          body: "A token reaches only the methods and paths on an explicit allowlist, and never inherits its owner's admin powers.",
        },
      ],
    },
    {
      title: "Smart Mix",
      lede: [
        "The transition planner, as an API.",
        "Tracks are addressed by their entity UID, which stays the same across rebuilds.",
      ],
      endpoints: [
        {
          method: "GET",
          path: "/api/tracks/by-entity/{uid}/mix-profile",
          body: "A track's Smart Mix profile: cue points, beat grid and loudness.",
        },
        {
          method: "GET",
          path: "/api/tracks/by-entity/{uid}/compatible",
          body: "Tracks that mix well with this one.",
        },
        {
          method: "POST",
          path: "/api/playback/transition-plans",
          body: "Transition plans for the tracks you send. Every plan is validated again by the player that runs it.",
        },
      ],
    },
    {
      title: "Run it",
      lede: ["A server in one line, or the whole stack for development."],
      install: true,
      snippets: [
        {
          label: "Develop",
          code: "git clone https://github.com/thecrateapp/crate.git\ncd crate\nnpm install\nmake dev",
        },
      ],
      features: [
        {
          title: "Run a server",
          body: "One line on Linux x86_64 with Docker. 4 cores and 8 GB RAM recommended.",
        },
        {
          title: "Develop",
          body: "make dev starts PostgreSQL, both Redises, the API, the read plane, the workers, the projector and the media worker with a small fixture library, plus the Admin and Listen dev servers. Admin runs on port 5173, Listen on 5174, the docs on 5175 and the API on 8585.",
        },
      ],
    },
    {
      title: "Contribute",
      lede: ["If you touch it, you test it."],
      features: [
        {
          title: "Tests",
          body: "Every feature, fix and refactor ships with tests for the behaviour it changes: pytest for Python, table-driven tests for Go, Vitest and Testing Library for TypeScript, cargo test for Rust. make dev-test runs them all.",
        },
        {
          title: "Commits",
          body: "Conventional commits: feat, fix, refactor, perf, test, docs and chore.",
        },
        {
          title: "License",
          body: "Crate is free software under the AGPL-3.0.",
        },
      ],
    },
    {
      title: "VirtualDJ",
      status: "coming-soon",
      lede: ["Crate as an online source inside VirtualDJ."],
      features: [
        {
          title: "Build",
          body: "A C++20 plugin built with CMake against the private VirtualDJ SDK.",
        },
        {
          title: "Same APIs",
          body: "It signs in with a personal access token and uses the Smart Mix APIs above.",
        },
        {
          title: "Status",
          body: "In development. It will require VirtualDJ Pro.",
        },
      ],
    },
    {
      title: "Docs",
      lede: ["The technical documentation goes deeper."],
      links: [
        {
          title: "Development setup",
          href: `${DOCS}/start/development-setup`,
        },
        { title: "Developer guide", href: `${DOCS}/developer/developer-guide` },
        { title: "API reference", href: `${DOCS}/reference/api-reference` },
        {
          title: "OpenSubsonic profile",
          href: `${DOCS}/architecture/opensubsonic-profile`,
        },
        {
          title: "System overview",
          href: `${DOCS}/architecture/system-overview`,
        },
        {
          title: "Workers and background services",
          href: `${DOCS}/architecture/workers-and-background-services`,
        },
        {
          title: "Federation protocol",
          href: `${DOCS}/federation/federation-protocol`,
        },
      ],
    },
  ],
};
