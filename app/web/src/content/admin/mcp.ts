import type { ScaleFigure } from "../architecture/en";
import type { Feature, Step } from "../../lib/chapters";

export type ToolKind = "read" | "plan" | "approval";

export interface ToolFamily {
  title: string;
  kind: ToolKind;
  body: string;
  tools: string[];
}

export type Actor = "agent" | "crate" | "person";

export interface FlowStep {
  id: string;
  actor: Actor;
  title: string;
  code: string;
  body: string;
  status: string;
}

export const MCP = {
  endpoint: "/mcp",
  discovery: "/.well-known/oauth-protected-resource/mcp",
  tools: 71,
  readOnly: 27,
  scopes: 32,
  limits: {
    readsPerMinute: 60,
    concurrentPerClient: 2,
    concurrentGlobal: 8,
    responseKiB: 64,
  },
  serviceToken: { bits: 256, days: 90 },
};

export const TOOL_KINDS: Record<ToolKind, string> = {
  read: "Read only",
  plan: "Preview, then apply",
  approval: "Always approved",
};

export const ACTORS: Record<Actor, string> = {
  agent: "Agent",
  crate: "Crate",
  person: "Person",
};

export const TOOL_FAMILIES: ToolFamily[] = [
  {
    title: "Diagnostics",
    kind: "read",
    body: "Instance and pipeline status, open library issues, one artist in full, diagnostics, library quality, Smart Mix coverage and the audit log.",
    tools: [
      "get_instance_status",
      "list_library_issues",
      "inspect_artist",
      "read_diagnostics",
      "get_library_quality",
      "get_smart_mix_status",
      "get_pipeline_status",
      "read_audit",
    ],
  },
  {
    title: "Checks and repairs",
    kind: "plan",
    body: "Run the health and quality checks, preview the repairs, then apply the plan once it is approved.",
    tools: [
      "run_health_check",
      "run_quality_check",
      "preview_repairs",
      "apply_repairs",
    ],
  },
  {
    title: "Library maintenance",
    kind: "plan",
    body: "Metadata, enrichment, analysis, sync, metadata export and rehydrate. Each one is planned first, then run.",
    tools: [
      "preview_metadata_update",
      "plan_enrichment",
      "plan_analysis",
      "plan_library_sync",
      "plan_metadata_export",
      "plan_metadata_rehydrate",
    ],
  },
  {
    title: "Instance operations",
    kind: "plan",
    body: "Retry or cancel jobs, change schedules and adjust the runtime policy.",
    tools: [
      "apply_job_retry",
      "apply_job_cancel",
      "preview_schedule_update",
      "preview_runtime_update",
    ],
  },
  {
    title: "Editorial playlists",
    kind: "plan",
    body: "Search for candidate tracks, prepare a playlist plan, apply it and set its publication.",
    tools: [
      "editorial_candidates_search",
      "editorial_plan_prepare",
      "editorial_plan_apply",
      "editorial_publication_set",
    ],
  },
  {
    title: "Shows",
    kind: "plan",
    body: "Find shows, preview the import and apply it.",
    tools: ["search_shows", "preview_shows_import", "apply_shows_import"],
  },
  {
    title: "Acquisition",
    kind: "approval",
    body: "FLAC from Soulseek, and missing albums or a missing discography from Tidal: search, preview, then apply. A Soulseek download reaches the library through a second plan.",
    tools: [
      "search_acquisition",
      "preview_acquisition",
      "apply_acquisition",
      "preview_acquisition_publication",
      "apply_acquisition_publication",
      "search_tidal_missing_albums",
      "preview_tidal_acquisition",
      "apply_tidal_acquisition",
      "search_tidal_missing_artist",
      "preview_tidal_artist_acquisition",
      "apply_tidal_artist_acquisition",
    ],
  },
];

export const NEVER = [
  "Generic task dispatch",
  "Arbitrary SQL",
  "Shell access",
  "Free-form settings",
];

export const NEVER_LABEL = "Never exposed to agents";

export const PLAN_REF = "v1 · sha256:7c41…e2d0";

export const APPROVAL_FLOW: FlowStep[] = [
  {
    id: "ask",
    actor: "agent",
    title: "Ask",
    code: "list_library_issues",
    body: "The agent reads the library and finds what needs work.",
    status: "Agent reads the library",
  },
  {
    id: "preview",
    actor: "agent",
    title: "Preview",
    code: "preview_repairs",
    body: "Crate works out exactly what would change. Nothing is written.",
    status: "Previewing · nothing written",
  },
  {
    id: "plan",
    actor: "crate",
    title: "Plan",
    code: PLAN_REF,
    body: "The change is stored as a plan with a version and a content hash.",
    status: "Plan stored · versioned and hashed",
  },
  {
    id: "approve",
    actor: "person",
    title: "Approve",
    code: "no MCP tool",
    body: "A person approves that exact version and hash in Admin.",
    status: "Waiting for a person",
  },
  {
    id: "apply",
    actor: "agent",
    title: "Apply",
    code: "apply_repairs",
    body: "The approved plan runs. Applying it again changes nothing.",
    status: "Applying the approved plan",
  },
  {
    id: "audit",
    actor: "crate",
    title: "Audit",
    code: "read_audit",
    body: "The change is recorded under the agent's machine identity.",
    status: "Recorded in the audit log",
  },
];

export const FLOW_DONE = "Approved by a person · applied · audited";
export const APPROVED = "Approved in Admin";
export const NO_APPROVAL_TOOL = "The agent has no approval tool.";

export const SAFETY: Feature[] = [
  {
    title: "Agents prepare, people approve",
    body: "Agents can preview changes and prepare plans. Approving one is left to a person, in Admin.",
  },
  {
    title: "Bound to the exact plan",
    body: "An approval covers one plan version and its content hash. A changed plan needs a new approval.",
  },
  {
    title: "On when connected from Admin",
    body: "“Require approval before changes” starts on when you connect an agent in Admin, so every change waits for a person. An operator can turn it off per integration.",
  },
  {
    title: "Some changes always ask",
    body: "High-risk operations, whole-library operations and acquisition always need approval, whatever that setting says.",
  },
];

export const LIMITS: ScaleFigure[] = [
  { value: MCP.scopes, label: "Scopes" },
  { value: MCP.limits.readsPerMinute, label: "Reads per minute, per client" },
  {
    value: MCP.limits.concurrentPerClient,
    label: "Concurrent operations per client",
  },
  {
    value: MCP.limits.concurrentGlobal,
    label: "Concurrent operations, whole server",
  },
  { value: MCP.limits.responseKiB, label: "KiB per response, at most" },
  { value: MCP.serviceToken.days, label: "Days a service token lasts" },
];

export const LIMITS_NOTE =
  "Service token lifetime is the default. Every other figure is a fixed limit.";

export const ACCESS: Feature[] = [
  {
    title: "OAuth 2 with PKCE",
    body: "Authorization code flow with PKCE (S256). Refresh tokens rotate, and reusing an old one revokes the whole chain.",
  },
  {
    title: "Service tokens",
    body: `${MCP.serviceToken.bits}-bit tokens, stored only as a SHA-256 hash, valid for ${MCP.serviceToken.days} days by default.`,
  },
  {
    title: "Scopes with a human meaning",
    body: `Each of the ${MCP.scopes} scopes maps to a permission a person can hold in Crate.`,
  },
  {
    title: "Checked on every call",
    body: "An agent may do only what its granted scopes, the integration's grants and the user's current permissions all allow. That intersection is checked again on every call.",
  },
  {
    title: "Audited",
    body: "Agent activity is audited by machine identity.",
  },
];

export const PRESETS = [
  "Read only",
  "Shows curator",
  "Editorial curator",
  "Library maintainer",
  "Custom",
];

export const CLIENTS = "Claude Code, Codex and HTTP clients";

export const CONNECT: Step[] = [
  {
    title: "Pick a preset",
    body: `In Admin → Agents, choose “Connect an agent” and a preset: ${PRESETS.slice(
      0,
      -1,
    ).join(", ")} or ${PRESETS.at(-1)}.`,
  },
  {
    title: "Copy the config",
    body: `Crate shows a one-time token with config ready to paste into ${CLIENTS}.`,
  },
  {
    title: "Connect",
    body: `The client talks to ${MCP.endpoint} on your Crate API, with the scopes of the preset you picked.`,
  },
];

export const OAUTH_CONNECT = {
  register:
    "Or use OAuth: register the client in Admin → Agents → Connections. The client discovers the server at",
  discovery: MCP.discovery,
  consent: ", then you sign in and consent.",
};

export const OPT_IN =
  "MCP is opt-in. It stays off until a server operator enables it.";

export const OWN_AI: Feature = {
  title: "Crate's own AI",
  body: "Separate from MCP, Admin configures 11 AI actions, among them show extraction, artist bios, genre descriptions, taxonomy and EQ suggestions, playlist descriptions, artwork analysis, Music Paths refinement and translation drafts. They run on Gemini, DeepSeek or a local Ollama, the operator picks the default model, and stored API keys are encrypted.",
  status: "optional-llm",
};

export const MCP_HEADINGS = {
  tools: "What an agent can do",
  toolsCount: `${MCP.tools} tools · only the ${MCP.readOnly} read-only ones until an operator sets CRATE_MCP_ACTIONS_ENABLED`,
  safety: "Nothing changes without a person",
  access: "Access and limits",
  connect: "Connect in three steps",
  endpoint: "Endpoint",
  related: "Also in Admin",
};
