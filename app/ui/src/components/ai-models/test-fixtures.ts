import type {
  Action,
  Activity,
  Connection,
  DefaultModelState,
  ModelsResponse,
  Profile,
  Snapshot,
  Usage,
} from "./types";

export const STUDIO_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const ENV_GEMINI_PERSISTENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const PROFILE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const LEGACY_MODEL_ID = "gemini-3.8-flash";

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

const ACTIONS: Action[] = [
  {
    id: "shows.extract.vision",
    label: "Extract shows from image",
    group: "shows",
    input: "image",
    permission: "curation.shows.write",
    location: "/upcoming",
    description:
      "Extract tour rows from a poster or screenshot into show proposals.",
    maxima: {
      timeout_seconds: 90,
      max_output_tokens: 16000,
      max_input_tokens: 131072,
      max_image_pixels: 20000000,
      max_proposals: 200,
      max_selected: 50,
    },
  },
  {
    id: "shows.extract.text",
    label: "Extract shows from text",
    group: "shows",
    input: "text",
    permission: "curation.shows.write",
    location: "/upcoming",
    description:
      "Extract show proposals from pasted text or a public page read by a worker.",
    maxima: {
      timeout_seconds: 45,
      max_output_tokens: 16000,
      max_input_tokens: 131072,
      max_image_pixels: null,
      max_proposals: 200,
      max_selected: 50,
    },
  },
  {
    id: "genres.eq.propose",
    label: "Propose genre EQ",
    group: "genres",
    input: "text",
    permission: "curation.genres.write",
    location: "/genres",
    description: "Propose a validated ten-band EQ preset and explanation.",
    maxima: {
      timeout_seconds: 45,
      max_output_tokens: 2048,
      max_input_tokens: 131072,
      max_image_pixels: null,
      max_proposals: null,
      max_selected: null,
    },
  },
  {
    id: "music_paths.refine",
    label: "Refine Music Path",
    group: "discovery",
    input: "text",
    permission: "library.view",
    location: "/settings",
    description: "Refine a deterministic route using only the permitted IDs.",
    maxima: {
      timeout_seconds: 8,
      max_output_tokens: 4096,
      max_input_tokens: 131072,
      max_image_pixels: null,
      max_proposals: null,
      max_selected: null,
    },
  },
];

const CONNECTIONS: Connection[] = [
  {
    id: STUDIO_ID,
    persistent_id: STUDIO_ID,
    label: "Studio",
    provider: "gemini",
    revision: 2,
    endpoint: null,
    enabled: true,
    model_count: 3,
    catalog_status: "error",
    catalog_error_code: "AI_CATALOG_STALE",
    catalog_updated_at: null,
    max_concurrent: 2,
    daily_calls: 100,
    daily_tokens: 1000000,
    source: "stored",
    has_key: true,
    last4: null,
    read_only: false,
  },
  {
    id: "env:gemini",
    persistent_id: ENV_GEMINI_PERSISTENT_ID,
    label: "Environment",
    provider: "gemini",
    revision: 0,
    endpoint: null,
    enabled: true,
    model_count: 2,
    catalog_status: "ready",
    catalog_error_code: null,
    catalog_updated_at: hoursAgo(1),
    max_concurrent: 2,
    daily_calls: 100,
    daily_tokens: 1000000,
    source: "environment",
    has_key: true,
    last4: "abcd",
    read_only: true,
  },
  {
    id: "env:deepseek",
    persistent_id: null,
    label: "Environment",
    provider: "deepseek",
    revision: 0,
    endpoint: null,
    enabled: true,
    model_count: 0,
    catalog_status: "pending",
    catalog_error_code: null,
    catalog_updated_at: null,
    max_concurrent: 2,
    daily_calls: 100,
    daily_tokens: 1000000,
    source: "environment",
    has_key: false,
    last4: null,
    read_only: true,
  },
];

const PROFILE: Profile = {
  id: PROFILE_ID,
  label: "Poster",
  current_version: 1,
  created_at: hoursAgo(2),
  versions: [
    {
      profile_id: PROFILE_ID,
      version: 1,
      connection_id: STUDIO_ID,
      model_id: LEGACY_MODEL_ID,
      config: {
        reasoning: {
          mode: "provider_default",
          level: null,
          budget_tokens: null,
        },
        image_detail: "default",
        timeout_seconds: 45,
        max_output_tokens: 4096,
        max_input_tokens: 131072,
      },
      fingerprint: "a".repeat(64),
      created_at: hoursAgo(2),
    },
  ],
};

function legacyAction(
  actionId: string,
  timeoutSeconds: number,
  maxTokens: number,
) {
  return {
    action_id: actionId,
    provider: "gemini",
    supported: true,
    model_id: LEGACY_MODEL_ID,
    legacy_model: `gemini/${LEGACY_MODEL_ID}`,
    effective_timeout_seconds: timeoutSeconds,
    legacy_options: {
      timeout_seconds: timeoutSeconds,
      max_tokens: maxTokens,
      image_detail: "default",
    },
  };
}

export function aiSnapshot(): Snapshot {
  return {
    revision: 1,
    migrated: false,
    review_fingerprint: "f".repeat(64),
    truncated: false,
    actions: ACTIONS.map((action) => ({ ...action })),
    engines: [{ provider: "gemini", supported: true }],
    connections: CONNECTIONS.map((connection) => ({ ...connection })),
    profiles: [structuredClone(PROFILE)],
    bindings: [],
    default_model: null,
    legacy_actions: [
      legacyAction("shows.extract.vision", 90, 16000),
      legacyAction("shows.extract.text", 45, 16000),
      legacyAction("genres.eq.propose", 45, 2048),
      legacyAction("music_paths.refine", 8, 4096),
    ],
  };
}

export function migratedSnapshot(): Snapshot {
  const base = aiSnapshot();
  const defaultModel: DefaultModelState = {
    connection_id: STUDIO_ID,
    model_id: LEGACY_MODEL_ID,
    reasoning: { mode: "provider_default", level: null, budget_tokens: null },
    available: true,
    error_code: null,
    features: [
      { action_id: "shows.extract.vision", status: "default", reason: null },
      {
        action_id: "shows.extract.text",
        status: "incompatible",
        reason: "AI_CONTEXT_TOO_SMALL",
      },
      { action_id: "genres.eq.propose", status: "override", reason: null },
      { action_id: "music_paths.refine", status: "default", reason: null },
    ],
  };
  return {
    ...base,
    migrated: true,
    default_model: defaultModel,
    bindings: [
      {
        action_id: "shows.extract.vision",
        profile_id: PROFILE_ID,
        profile_version: 1,
        revision: 1,
        enabled: true,
      },
      {
        action_id: "shows.extract.text",
        profile_id: PROFILE_ID,
        profile_version: 1,
        revision: 1,
        enabled: false,
      },
      {
        action_id: "genres.eq.propose",
        profile_id: PROFILE_ID,
        profile_version: 1,
        revision: 1,
        enabled: true,
      },
      {
        action_id: "music_paths.refine",
        profile_id: PROFILE_ID,
        profile_version: 1,
        revision: 3,
        enabled: true,
      },
    ],
  };
}

export const catalog: ModelsResponse = {
  models: [
    {
      provider: "gemini",
      model_id: LEGACY_MODEL_ID,
      label: "Gemini 3.8 Flash",
      input_modalities: ["text", "image"],
      structured_output: true,
      validated: true,
      source: "manifest",
      reasoning_levels: ["low", "high"],
      reasoning_disabled: false,
      reasoning_enabled: false,
      thinking_budget_min: null,
      thinking_budget_max: null,
      max_output_tokens: 16000,
      context_window: 1000000,
      image_details: ["default", "high"],
    },
    {
      provider: "gemini",
      model_id: "budget",
      label: "Budget",
      input_modalities: ["text"],
      structured_output: true,
      validated: true,
      source: "manifest",
      reasoning_levels: [],
      reasoning_disabled: true,
      reasoning_enabled: true,
      thinking_budget_min: 1,
      thinking_budget_max: 100,
      max_output_tokens: 4000,
      context_window: 32000,
      image_details: ["default"],
    },
  ],
  status: "ready",
  updated_at: hoursAgo(1),
  error_code: null,
};

export function usageFixture(now: Date): Usage {
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return {
    legacy_usage_unknown: false,
    truncated: false,
    totals: {
      calls: 12,
      tokens: 5000,
      unknown_calls: 0,
      estimated_cost: null,
      completed: 10,
      failed: 2,
    },
    daily: [
      {
        day: today,
        connection_id: STUDIO_ID,
        invocation_kind: "action",
        action_id: "shows.extract.vision",
        calls: 3,
        tokens: 900,
        unknown_calls: 0,
        completed: 2,
        failed: 1,
        estimated_cost: null,
      },
      {
        day: today,
        connection_id: STUDIO_ID,
        invocation_kind: "action",
        action_id: "genres.eq.propose",
        calls: 1,
        tokens: 300,
        unknown_calls: 0,
        completed: 1,
        failed: 0,
        estimated_cost: null,
      },
      {
        day: yesterday,
        connection_id: STUDIO_ID,
        invocation_kind: "action",
        action_id: "shows.extract.text",
        calls: 8,
        tokens: 3800,
        unknown_calls: 0,
        completed: 7,
        failed: 1,
        estimated_cost: null,
      },
    ],
  };
}

export const activityFixture: Activity = {
  items: [
    {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      connection_id: STUDIO_ID,
      invocation_kind: "action",
      action_id: "shows.extract.vision",
      profile_id: PROFILE_ID,
      profile_version: 1,
      model_id: LEGACY_MODEL_ID,
      reported_model: LEGACY_MODEL_ID,
      actor_id: 1,
      job_id: null,
      status: "succeeded",
      input_tokens: 500,
      output_tokens: 120,
      thought_tokens: null,
      cached_input_tokens: null,
      total_tokens: 620,
      charged_tokens: 620,
      reserved_tokens: 620,
      metering_mode: "enforced",
      usage_known: true,
      error_code: null,
      duration_ms: 2300,
      estimated_cost: null,
      created_at: hoursAgo(1),
    },
  ],
  next_cursor: null,
};
