export interface Model {
  provider: string;
  model_id: string;
  label: string;
  input_modalities: string[];
  structured_output: boolean;
  validated: boolean;
  source: string;
  reasoning_levels: string[];
  reasoning_disabled: boolean;
  reasoning_enabled: boolean;
  thinking_budget_min: number | null;
  thinking_budget_max: number | null;
  max_output_tokens: number | null;
  context_window: number | null;
  image_details: string[];
  /** Per-image token reservation; null when image features can't be admitted. */
  image_token_bound?: number | null;
}
export interface ReasoningConfig {
  mode: "provider_default" | "enabled" | "disabled" | "level" | "budget";
  level: string | null;
  budget_tokens: number | null;
}
export interface ModelChoice {
  connectionId: string;
  modelId: string;
  reasoning: ReasoningConfig;
}
export interface Config {
  reasoning: ReasoningConfig;
  image_detail: string;
  timeout_seconds: number;
  max_output_tokens: number;
  max_input_tokens: number;
}
export interface LegacyConfig {
  kind: "legacy_snapshot";
  action_id: string;
  legacy_model: string;
  legacy_options: {
    timeout_seconds: number | null;
    max_tokens: number | null;
    image_detail: string;
  };
}
export interface Version {
  profile_id: string;
  version: number;
  connection_id: string;
  model_id: string;
  config: Config | LegacyConfig;
  fingerprint: string;
  created_at: string;
  /** The catalog model's per-image token reservation, when known. */
  image_token_bound?: number | null;
}
export interface Profile {
  id: string;
  label: string;
  current_version: number;
  created_at: string;
  versions: Version[];
}
export interface Connection {
  id: string;
  persistent_id: string | null;
  label: string;
  provider: string;
  revision: number;
  endpoint: string | null;
  enabled: boolean;
  model_count: number;
  catalog_status: string;
  catalog_error_code: string | null;
  catalog_updated_at: string | null;
  max_concurrent: number;
  daily_calls: number;
  daily_tokens: number;
  source: string;
  has_key: boolean;
  last4: string | null;
  read_only: boolean;
}
export interface Action {
  id: string;
  label: string;
  group: string;
  input: string;
  permission: string;
  location: string;
  description: string;
  maxima: {
    timeout_seconds: number;
    max_output_tokens: number;
    max_input_tokens: number;
    max_image_pixels: number | null;
    max_proposals: number | null;
    max_selected: number | null;
  };
}
export interface Binding {
  action_id: string;
  profile_id: string;
  profile_version: number;
  revision: number;
  enabled: boolean;
}
export interface DefaultModelFeature {
  action_id: string;
  status: "default" | "override" | "incompatible";
  reason: string | null;
}
export interface DefaultModelState {
  connection_id: string;
  model_id: string;
  reasoning: ReasoningConfig;
  available: boolean;
  error_code: string | null;
  features: DefaultModelFeature[];
}
export interface Snapshot {
  revision: number;
  migrated: boolean;
  review_fingerprint: string;
  truncated: boolean;
  actions: Action[];
  engines: { provider: string; supported: boolean }[];
  connections: Connection[];
  profiles: Profile[];
  bindings: Binding[];
  default_model: DefaultModelState | null;
  legacy_actions: {
    action_id: string;
    provider: string;
    supported: boolean;
    model_id: string;
    legacy_model: string;
    effective_timeout_seconds: number | null;
    legacy_options: LegacyConfig["legacy_options"];
    /** Whether the feature runs on server settings (Music Paths has its own switch). */
    legacy_enabled?: boolean;
  }[];
}
export interface ModelsResponse {
  models: Model[];
  status: string;
  updated_at: string | null;
  error_code: string | null;
}
export interface Job {
  id: string;
  status: string;
  result: {
    status: string;
    error_code?: string | null;
    compatible?: boolean | null;
    model_count?: number | null;
  } | null;
}
export interface Enqueued {
  task_id: string | null;
  deduplicated: boolean;
  max_timeout_seconds?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
}
export interface AssignmentOutcome {
  action_id: string;
  outcome: "applied" | "unchanged" | "kept_legacy" | "kept_current" | "blocked";
  reason: string | null;
  adjustments: ("reasoning" | "image_detail")[];
  /** The feature's switch once applied; null when it can't be set up. */
  enabled?: boolean | null;
}
export interface ModelAssignmentResult {
  dry_run: boolean;
  activation: boolean;
  revision: number;
  review_fingerprint: string;
  outcomes: AssignmentOutcome[];
}
export interface Invocation {
  id: string;
  connection_id: string;
  invocation_kind: string;
  action_id: string | null;
  profile_id: string | null;
  profile_version: number | null;
  model_id: string;
  reported_model: string | null;
  actor_id: number | null;
  job_id: string | null;
  status: string;
  input_tokens: number | null;
  output_tokens: number | null;
  thought_tokens: number | null;
  cached_input_tokens: number | null;
  total_tokens: number | null;
  charged_tokens: number;
  reserved_tokens: number;
  metering_mode: string;
  usage_known: boolean;
  error_code: string | null;
  duration_ms: number;
  estimated_cost: number | null;
  created_at: string;
}
export interface Activity {
  items: Invocation[];
  next_cursor: string | null;
}
export interface DailyUsage {
  day: string;
  connection_id: string;
  invocation_kind: "action" | "probe";
  action_id: string | null;
  calls: number;
  tokens: number;
  unknown_calls: number;
  completed: number;
  failed: number;
  estimated_cost: number | null;
}
export interface Usage {
  legacy_usage_unknown: boolean;
  truncated: boolean;
  totals: {
    calls: number;
    tokens: number;
    unknown_calls: number;
    estimated_cost: number | null;
    completed: number;
    failed: number;
  };
  daily: DailyUsage[];
}
