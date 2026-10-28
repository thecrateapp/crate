import type { PageIntro } from "../../lib/chapters";

export const QUICKSTART = "https://docs.cratemusic.app/start/quickstart";

export interface Command {
  command: string;
  body: string;
  link?: { href: string; label: string };
}

export interface WizardStep {
  title: string;
  label: string;
  body: string;
}

export interface InstallPage extends PageIntro {
  requirements: string[];
  requirementsNote: string;
  video: { label: string; meta: string; caption: string };
  flow: {
    title: string;
    lede: string;
    steps: { title: string; body: string }[];
    open: [string, string][];
  };
  wizard: {
    title: string;
    lede: string;
    recorded: string;
    fromSource: string;
    steps: WizardStep[];
  };
  agent: {
    title: string;
    lede: string;
    features: { title: string; body: string }[];
    get: string;
    connect: string;
    ask: string;
  };
  after: {
    title: string;
    lede: string;
    commands: Command[];
    unattended: string;
    flags: [string, string][];
  };
  reference: { title: string; body: string; link: string };
}

export const install: InstallPage = {
  meta: {
    title: "Install — Crate",
    description:
      "Install Crate with one command on Linux or macOS with Docker. A seven-step wizard checks the machine, asks a few questions, shows every file before it writes one and starts Crate.",
  },
  eyebrow: "Install",
  title: "One line. Seven steps.",
  lede: "The installer checks your machine, asks a few plain questions and shows you everything before it writes a file.",
  requirements: ["Linux or macOS", "x86_64 or arm64", "Docker"],
  requirementsNote:
    "8 GB RAM recommended. About 4 GB of images the first time.",
  video: {
    label: "Recording",
    meta: "crate install · Debian",
    caption:
      "The whole wizard on a Debian server, recorded as a dry run, so nothing was written.",
  },
  flow: {
    title: "How it goes",
    lede: "One command, a few answers, and Crate is running.",
    steps: [
      {
        title: "Run the command",
        body: "It downloads the crate installer for your machine from the GitHub release, checks its checksum and starts it.",
      },
      {
        title: "Answer the wizard",
        body: "Seven steps: the machine, your music, how you reach Crate, integrations, the admin account, a review, then the install.",
      },
      {
        title: "Open Crate",
        body: "It starts Crate, waits until it answers and prints where to open it, with the admin password.",
      },
    ],
    open: [
      ["Listen", "http://localhost:8581"],
      ["Admin", "http://localhost:8580"],
      ["Password", "shown at the end"],
    ],
  },
  wizard: {
    title: "Inside the wizard",
    lede: "Every screen below is the installer's own text, recorded on a Debian server.",
    recorded: "Recorded · dry run",
    fromSource: "Real run · from the installer source",
    steps: [
      {
        title: "Checking this machine",
        label: "Docker checked",
        body: "System, processor, memory and disk come first. If Docker is missing on Linux, or on a Mac with Homebrew, it shows the commands that install it and runs them only when you say yes.",
      },
      {
        title: "Your music and Crate's data",
        label: "Your files stay put",
        body: "Point it at your library and a data folder. Crate reads the music in place, and creates the folder if it is not there yet.",
      },
      {
        title: "How you will reach Crate",
        label: "Four ways in",
        body: "Ports, local names in /etc/hosts, local names for every device with dnsmasq, or public HTTPS on your own domain through Cloudflare, with free certificates from Let's Encrypt.",
      },
      {
        title: "Integrations",
        label: "Checked live",
        body: "Nothing is required. Each service you pick comes with step-by-step instructions, and its key is checked with the provider as soon as you enter it.",
      },
      {
        title: "Your admin account",
        label: "Generated password",
        body: "Leave the password empty and Crate generates a strong one. You see it when the installation finishes.",
      },
      {
        title: "Review",
        label: "Nothing written yet",
        body: "Every setting and every file it will write, before it writes any of them. Say no and nothing changes.",
      },
      {
        title: "Installing",
        label: "Running",
        body: "It downloads Crate, starts it and waits until it answers. Then it prints the addresses, the admin password and what to do next.",
      },
    ],
  },
  agent: {
    title: "Let your AI install it",
    lede: "crate mcp turns the installer into an MCP server. Claude Code, Codex or any MCP client asks you what it needs and does the work.",
    features: [
      {
        title: "The same installation",
        body: "Twelve tools to check the machine, choose the settings, write the files, start Crate and run the doctor. The result is what crate install would build.",
      },
      {
        title: "Your keys stay with you",
        body: "API keys, tokens and the admin password are never typed in the chat. You enter them on a private page served on 127.0.0.1; the agent only learns whether each was accepted.",
      },
      {
        title: "It asks first",
        body: "The agent is told to confirm before it writes files or starts Crate, and to run privileged commands only with your approval.",
      },
    ],
    get: "curl -fsSL https://cratemusic.app/install.sh | CRATE_INSTALLER_ONLY=1 bash",
    connect: "claude mcp add crate-installer -- crate mcp",
    ask: "Install Crate on this computer with the crate-installer tools. Ask me what you need.",
  },
  after: {
    title: "After install",
    lede: "The installer stays on your machine. Use it to change, extend and check Crate.",
    commands: [
      {
        command: "crate configure",
        body: "Set up or change integrations: Last.fm, Soulseek, Crate Agent and the rest. Each key is checked with its provider.",
      },
      {
        command: "crate configure agent",
        body: "Crate Agent answers questions about your library, jobs and health on Telegram. Crate Operator can also make changes you approve.",
        link: { href: "/admin#telegram-agent", label: "Crate Agent" },
      },
      {
        command: "crate configure agent --sign-in",
        body: "Sign Crate Agent in to its model provider when it uses ChatGPT or Nous.",
      },
      {
        command: "crate doctor",
        body: "Checks the installation, Docker, every service, the API and each configured key, and says how to fix what fails. Add --json for scripts.",
      },
      {
        command: "crate install",
        body: "Run it again to change anything. It keeps your secrets and your manual edits.",
      },
      {
        command: "crate install --yes",
        body: "Never asks: defaults plus CRATE_* environment overrides, for unattended installs.",
      },
      {
        command: "crate install --accessible",
        body: "Plain prompts that work with screen readers.",
      },
    ],
    unattended:
      "curl -fsSL https://cratemusic.app/install.sh \\\n  | CRATE_ASSUME_YES=1 \\\n    CRATE_ACCESS_MODE=cloudflare \\\n    CRATE_INSTALL_DIR=/opt/crate \\\n    CRATE_MUSIC_DIR=/srv/music \\\n    CRATE_DOMAIN=example.com \\\n    CF_DNS_API_TOKEN=cloudflare-token \\\n    DEFAULT_ADMIN_PASSWORD=change-me \\\n    bash",
    flags: [
      ["--dry-run", "show what would happen, write nothing"],
      ["--skip-start", "write the files, do not start Crate"],
      ["--dir", "choose the install folder"],
    ],
  },
  reference: {
    title: "Full reference",
    body: "Prerequisites, access modes, unattended installs, checking and updating an installation.",
    link: "Read the quickstart",
  },
};
