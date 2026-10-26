import type { Status, Step } from "../../lib/chapters";
import { PLAN_REF } from "./mcp";

const DOCS = "https://docs.cratemusic.app";

export const AGENT = {
  confirmMinutes: 15,
  tidalMaxAlbums: 50,
  guide: {
    href: `${DOCS}/operations/crate-agent`,
    label: "Read the Crate Agent and Crate Operator guide",
  },
};

export interface AgentProfile {
  id: "agent" | "operator";
  title: string;
  status: Status;
  summary: string;
  scope: string[];
}

export const PROFILES: AgentProfile[] = [
  {
    id: "agent",
    title: "Crate Agent",
    status: "opt-in",
    summary:
      "Read-only. Diagnoses your instance and never claims to have changed anything.",
    scope: [
      "Instance status",
      "Jobs",
      "Logs",
      "Library issues",
      "Artist inspection",
      "Quality",
      "Analysis",
      "Audit",
      "Schedules",
      "Runtime policy",
    ],
  },
  {
    id: "operator",
    title: "Crate Operator",
    status: "opt-in",
    summary:
      "Plans and applies changes through MCP. Every change waits for a person to approve it in Telegram.",
    scope: [
      "Repairs",
      "Sync",
      "Analysis",
      "Enrichment",
      "Metadata",
      "Schedules",
      "Job retry and cancel",
      "Shows",
      "Editorial playlists",
      "Soulseek and Tidal acquisition",
    ],
  },
];

export const DISABLED_LABEL = "Switched off";

export const DISABLED = [
  "Terminal",
  "Files",
  "Web",
  "Cron",
  "Docker socket",
  "SSH",
  "Music mount",
];

export const APPROVAL_BUTTONS = ["Next", "Approve", "Reject"] as const;

export const APPROVAL_RULES = [
  `Native Telegram buttons: ${APPROVAL_BUTTONS.join(", ")}.`,
  "Every page of the exact plan is delivered before Approve is possible.",
  "Free text never approves.",
  `Confirmations expire after ${AGENT.confirmMinutes} minutes.`,
  "Admin approval pages remain as a fallback.",
];

export const ACQUISITION_RULES = [
  `Tidal: one album, or a full discography of up to ${AGENT.tidalMaxAlbums} albums, takes one mandatory approval and never overwrites albums you already have.`,
  "Soulseek: the transfer and the publication are approved separately.",
];

export const SUPERVISOR =
  "A supervisor posts alerts to the chat on its own: failed tasks, health alerts and new releases.";

export const ACCESS = {
  title: "Who can talk to it",
  body: "Only allowlisted Telegram user IDs. Bots are refused.",
};

export const MODELS = {
  title: "Your model",
  body: "ChatGPT, signed in with your account, or an API key for one of these providers. Or a local model through Ollama or any OpenAI-compatible endpoint. Switching model is one command:",
  command: "make agent-model",
  providers: ["OpenAI", "Anthropic", "OpenRouter", "Gemini", "DeepSeek"],
};

export interface SetupStep extends Step {
  code: string;
}

export const SETUP: SetupStep[] = [
  {
    title: "Create a bot",
    code: "@BotFather",
    body: "Create a Telegram bot with BotFather and keep its token.",
  },
  {
    title: "Run the guided setup",
    code: "make agent-init",
    body: "Validates the token and user IDs, creates the MCP credential with the exact permissions of the chosen profile, stores the secrets and signs in to the model.",
  },
  {
    title: "Start it",
    code: "make agent-up",
    body: "Choose the profile with AGENT_PROFILE=agent or AGENT_PROFILE=operator. It comes up in your stack and answers in the chat.",
  },
];

export const AGENT_HEADINGS = {
  title: "Crate Agent and Crate Operator, in Telegram",
  optIn: "Both profiles are opt-in, for any Crate instance.",
  lede: [
    "AI operators that live in a Telegram chat. Crate Agent diagnoses your instance. Crate Operator can also apply the changes you approve.",
    "Both are clients of Crate's MCP server and carry a release-pinned index of Crate's own docs and code, so they explain your instance with live evidence. They replace Crate's older built-in Telegram bot.",
  ],
  profiles: "Two profiles",
  approval: "How a change is approved",
  acquisition: "Acquisition",
  setup: "Set up in three steps",
};

export interface ChatBeat extends Step {
  status: string;
}

export const CHAT_BEATS: ChatBeat[] = [
  {
    title: "Ask",
    body: "You ask in plain words, from an allowlisted account.",
    status: "Question received",
  },
  {
    title: "Evidence",
    body: "Crate Operator reads your instance through MCP and answers with what it found.",
    status: "Reading the instance · nothing written",
  },
  {
    title: "Plan",
    body: "It prepares the change and sends the exact plan, one page at a time.",
    status: "Delivering the plan",
  },
  {
    title: "Approve",
    body: "Approve is possible only after the last page. A message never approves.",
    status: "Waiting for a person",
  },
  {
    title: "Report",
    body: "The job is queued, and the outcome comes back to the same chat.",
    status: "Queued · supervisor watching",
  },
];

export const CHAT_DONE = "Approved in Telegram · queued · reported";

export type PlanButton = "next" | "approve" | "reject";

export type ChatEntry =
  | { kind: "user"; beat: number; text: string }
  | { kind: "tools"; beat: number; tools: string[] }
  | { kind: "bot"; beat: number; text: string }
  | {
      kind: "page";
      beat: number;
      page: number;
      pages: number;
      lines: string[];
      buttons: PlanButton[];
    }
  | { kind: "decision"; beat: number; text: string }
  | { kind: "alert"; beat: number; from: string; text: string };

export const BUTTON_LABELS: Record<PlanButton, string> = {
  next: "Next",
  approve: "Approve",
  reject: "Reject",
};

export const CHAT: ChatEntry[] = [
  { kind: "user", beat: 0, text: "Why is library sync so slow today?" },
  {
    kind: "tools",
    beat: 1,
    tools: ["get_pipeline_status", "read_diagnostics", "list_library_issues"],
  },
  {
    kind: "bot",
    beat: 1,
    text: "Sync is running, not stuck. It is working through 3 album folders that drift from the artist layout, and diagnostics list 14 files on disk that were never indexed. One repair covers both.",
  },
  { kind: "user", beat: 2, text: "Fix it." },
  { kind: "tools", beat: 2, tools: ["preview_repairs"] },
  {
    kind: "bot",
    beat: 2,
    text: "A message is not an approval. Here is the exact plan, in 3 pages. Approve opens on the last one.",
  },
  {
    kind: "page",
    beat: 2,
    page: 1,
    pages: 3,
    lines: ["targets: 3 album folders", "change: move into the artist layout"],
    buttons: ["next", "reject"],
  },
  {
    kind: "page",
    beat: 2,
    page: 2,
    pages: 3,
    lines: ["targets: 14 files on disk", "change: index into the catalog"],
    buttons: ["next", "reject"],
  },
  {
    kind: "page",
    beat: 3,
    page: 3,
    pages: 3,
    lines: [
      `plan: ${PLAN_REF}`,
      `expires: ${AGENT.confirmMinutes} min`,
      "apply after approval: yes",
    ],
    buttons: ["approve", "reject"],
  },
  { kind: "decision", beat: 3, text: `You approved ${PLAN_REF}` },
  {
    kind: "bot",
    beat: 4,
    text: "Approved. The repair job is queued and the supervisor is watching it.",
  },
  {
    kind: "alert",
    beat: 4,
    from: "Supervisor",
    text: "Repair job finished · 3 folders moved · 14 files indexed",
  },
];

export const CHAT_LABEL = `An example Crate Operator chat in Telegram. ${CHAT_BEATS.map(
  (beat) => `${beat.title}: ${beat.body}`,
).join(" ")}`;
