export interface AgentScope {
  scope: string;
  capability: string;
  can_grant: boolean;
  label: string;
  group: string;
  access: "read" | "change";
}

export interface AgentScopePreset {
  id: string;
  label: string;
  description: string;
  scopes: string[];
}

export interface AgentCatalog {
  mcp_enabled: boolean;
  actions_enabled: boolean;
  oauth_enabled: boolean;
  scopes: AgentScope[];
  scope_groups: { id: string; label: string }[];
  presets: AgentScopePreset[];
  mcp_url: string | null;
  tools: {
    name: string;
    grant: string | null;
    enabled: boolean;
    reason: string | null;
  }[];
  limits: {
    calls_per_minute: number;
    concurrent_calls: number;
    active_maintenance_jobs: number;
  };
}

export interface AgentIntegration {
  principal_id: string;
  name: string;
  kind: "service" | "delegated";
  enabled: boolean;
  grants: string[];
  require_approval: boolean;
  policy_revision: number;
  last_activity_at: string | null;
  credentials_truncated?: boolean;
  authorizations_truncated?: boolean;
  credentials:
    | { credential_id: string; expires_at: string; revoked_at: string | null }[]
    | null;
  authorizations:
    | {
        authorization_id: string;
        user_id: number;
        client_id: string;
        revoked_at: string | null;
      }[]
    | null;
}

export interface AgentSecret {
  token: string;
  credential_id: string;
  expires_at: string;
}

export interface AgentCollection<T> {
  items: T[];
  next_cursor?: string | null;
}

export interface AgentPlanSummary {
  plan_id: string;
  principal_id: string;
  state: string;
  expires_at: string;
  approval_required: boolean;
  operation?: string;
}

export interface AgentPlanListItem extends AgentPlanSummary {
  created_at: string;
  integration_name: string | null;
  integration_kind: "service" | "delegated" | "human" | null;
  target_count: number;
  risk: string;
  expired: boolean;
}

export interface AgentEditorialContent {
  kind:
    | "create"
    | "duplicate"
    | "edit"
    | "refine"
    | "regenerate"
    | "visibility"
    | "refresh_policy";
  metadata: {
    name: string;
    description: string;
    scope: string;
    visibility: string;
    generation_mode: "static" | "smart";
    is_active: boolean;
    auto_refresh_enabled: boolean;
  };
  selection: {
    row_id: number | null;
    track_uid: string | null;
    global_track_uid: string | null;
    title: string | null;
    artist: string | null;
    album: string | null;
    duration: number | null;
    position: number;
    source: string;
    locked: boolean;
  }[];
  smart_rules: Record<string, unknown> | null;
  new_exclusions: string[];
  existing_exclusions: {
    track_uid: string | null;
    global_track_uid: string | null;
  }[];
  copied_exclusions: AgentEditorialContent["existing_exclusions"];
  source_revision: number | null;
  generation_epoch: number | null;
  provenance: Record<string, unknown>;
}

export interface AgentPlan
  extends AgentPlanSummary, Partial<AgentEditorialContent> {
  job_id?: string | null;
  created_at?: string;
  integration_name?: string | null;
  integration_kind?: string | null;
  requester_name?: string | null;
  plan_version: string;
  content_hash: string;
  authorization_context_hash: string;
  policy_revision: number;
  operation: string;
  risk: string;
  target_count: number;
  returned_count: number;
  truncated: boolean;
  targets: {
    artist_uid?: string;
    entity_uid?: string;
    entity_type?: string;
    label?: string;
    name?: string;
    scope?: string;
  }[];
  changes: Record<string, unknown>[];
  impact: Record<string, unknown>;
  reversibility: string;
  source_versions?: Record<string, unknown>;
  conflicts?: Record<string, unknown>[];
  executable?: boolean;
  authorization_context: {
    human_actor_id?: number | null;
    actor_user_id?: number | null;
    client_id?: string;
    authorization_id?: string;
  };
}
