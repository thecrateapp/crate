import type { ScreenMarks } from "../../lib/terminal-screen";

export type ScreenSource = "recording" | "source";

export interface WizardScreen {
  text: string;
  marks: ScreenMarks;
  source: ScreenSource;
}

const RULE = `  ${"─".repeat(76)}`;

export const SCREENS: WizardScreen[] = [
  {
    source: "recording",
    marks: {
      dots: ["ok", "ok", "ok", "ok", "info"],
      strong: ["crate"],
      muted: ["Self-hosted music, set up step by step."],
    },
    text: `
you@homeserver:~$ crate install

  crate
  Self-hosted music, set up step by step.


  STEP 1 OF 7
${RULE}
  Checking this machine
  Crate runs as a set of Docker containers. Let's make sure this machine can
  host them.

  ● System          Linux (debian)
  ● Architecture    arm64
  ● Memory          8 GB
  ● Disk space      480 GB free in /home/you
  ● Docker          not checked in a dry run
`,
  },
  {
    source: "recording",
    marks: {},
    text: `
  STEP 2 OF 7
${RULE}
  Your music and Crate's data
  Crate reads your library in place and never moves files without asking. Its
  database, cache and artwork live in the data folder.

  Music library
  The folder with your albums, usually Artist/Album/Track. It can be a network
  mount.
  > /home/you/crate/media/music

  Crate data
  Database, cache and artwork. Keep it on a fast disk; it grows with your
  library.
  > /home/you/crate/data

  Timezone
  Used for listening stats and the nightly maintenance window.
  > Europe/Madrid

┃ Instance name
┃ How this Crate introduces itself to apps and other servers.
┃ > Crate

shift+tab back • enter submit
`,
  },
  {
    source: "recording",
    marks: { dots: ["warn"], context: 3 },
    text: `
  ● The music folder does not exist yet. Crate will create it; copy your
    albums there whenever you like.

  STEP 3 OF 7
${RULE}
  How you will reach Crate
  Pick how browsers and the mobile apps find this server. You can change it
  later by running the installer again.

┃ Access
┃   Ports  ·  http://localhost:8581 on this machine and your network
┃   Local names  ·  listen.crate.local on this machine (/etc/hosts)
┃   Local names for every device  ·  a small DNS server (dnsmasq)
┃ > Public HTTPS  ·  your own domain through Cloudflare

↑ up • ↓ down • / filter • enter submit
`,
  },
  {
    source: "recording",
    marks: {},
    text: `
  STEP 4 OF 7
${RULE}
  Integrations
  Crate works on its own. These services add artwork, biographies, concerts,
  downloads and alerts; each takes a minute to set up. Add or change them any
  time with \`crate configure\`.

┃ What do you want to set up now?
┃ Space selects, enter continues. Nothing is required.
┃   ● Last.fm              biographies, tags and similar artists  recommended
┃   ● Fanart.tv            artist photos and logos  recommended
┃   ○ Spotify              popularity and artwork
┃   ○ Discogs              credits, labels and editions
┃   ○ Setlist.fm           probable setlists
┃   ○ Ticketmaster         upcoming concerts
┃   ○ Soulseek             downloads through slskd
┃   ○ Tidal                lossless downloads
┃   ○ AI models            Gemini, OpenAI, Anthropic or Ollama
┃ > ○ Agents (MCP)         Claude, Codex and other agents
┃   ○ Crate Agent          ask about your Crate on Telegram
┃   ○ Sign in with Google  listeners sign in with Google
┃   ○ Sign in with Apple   listeners sign in with Apple
┃

x toggle • ↑ up • ↓ down • / filter • enter submit • ctrl+a select all
`,
  },
  {
    source: "recording",
    marks: { strong: ["admin@cratemusic.app"] },
    text: `
  STEP 5 OF 7
${RULE}
  Your admin account
  You sign in to Admin and Listen with this account. Invite other people from
  Admin later.

  admin@cratemusic.app

  This is the admin user's email. Choose its password, or leave it empty and
  Crate will generate a strong one.


┃ Password
┃ >

  Repeat the password
  >

enter next
`,
  },
  {
    source: "recording",
    marks: { strong: ["Nothing has been written yet."], button: "Yes" },
    text: `
  STEP 6 OF 7
${RULE}
  Review
  Nothing has been written yet.

  Install folder  /home/you/crate
  Music library   /home/you/crate/media/music
  Crate data      /home/you/crate/data
  Timezone        Europe/Madrid
  Instance name   Crate
  Access          Ports
  Listen          http://localhost:8581
  Admin           http://localhost:8580
  Admin account   admin@cratemusic.app · generated, shown at the end
  Integrations    none yet

  FILES
  Create the music, data and downloads folders  /home/you/crate/media/music
  Write the Crate compose stack                 /home/you/crate/docker-compose.yaml
  Write Crate's configuration                   /home/you/crate/config.yaml
  Write the read-plane routes for Traefik       /home/you/crate/deploy/traefik/federation-readplane.yml
  Write the Crate Agent setup                   /home/you/crate/scripts/agent_setup.py
  Write Traefik's configuration                 /home/you/crate/data/traefik/traefik.yml
  Write the settings and secrets (owner-only)   /home/you/crate/.env

┃ Install Crate now?
┃ Images are about 4 GB the first time; later updates download only what
┃ changed.
┃
┃                                 Yes     No

←/→ toggle • enter submit • y Yes • n No
`,
  },
  {
    source: "source",
    marks: {
      dots: ["ok", "ok"],
      strong: ["4c1e9a07b2d85f36e0a1c7d4"],
      muted: [
        "Save it in your password manager; it is also DEFAULT_ADMIN_PASSWORD in .env.",
      ],
    },
    text: `
  STEP 7 OF 7
${RULE}
  Installing

  ● Settings and secrets written to /home/you/crate/.env

  DOWNLOADING CRATE
  ⋮

  STARTING CRATE
  ⋮

  ● Crate is running

  OPEN CRATE
  Listen  http://localhost:8581
  Admin   http://localhost:8580

  SIGN IN
  Email     admin@cratemusic.app
  Password  4c1e9a07b2d85f36e0a1c7d4
  Save it in your password manager; it is also DEFAULT_ADMIN_PASSWORD in .env.

  NEXT
  1  Copy or mount your albums into /home/you/crate/media/music
  2  Sign in to Admin; Crate scans the library and starts enriching it
  3  Install the Listen app on your phone and add http://localhost:8585

  MANAGE
  Status           cd /home/you/crate && docker compose ps
  Logs             cd /home/you/crate && docker compose logs -f
  Integrations     crate configure --dir /home/you/crate
  Health           crate doctor --dir /home/you/crate
  Everything else  crate install --dir /home/you/crate
`,
  },
];
