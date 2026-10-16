export const permissionLabels: Record<string, string> = {
  "library.health.read": "Inspect library health",
  "library.health.run": "Check an artist's photo",
  "library.repair.photo_flag": "Update an artist's photo flag",
  "ops.status.read": "Read instance status",
  "ops.jobs.read": "Read job history",
  "ops.jobs.retry": "Retry owned health checks",
  "ops.jobs.cancel_pending": "Cancel owned pending jobs",
  "ops.logs.read": "Read worker logs",
};

export interface AgentCatalog {
  mcp_enabled: boolean;
  actions_enabled: boolean;
  oauth_enabled: boolean;
  scopes: { scope: string; can_grant: boolean }[];
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
}

export interface AgentPlan extends AgentPlanSummary {
  job_id?: string | null;
  plan_version: string;
  content_hash: string;
  authorization_context_hash: string;
  policy_revision: number;
  operation: string;
  risk: string;
  target_count: number;
  returned_count: number;
  truncated: boolean;
  targets: { artist_uid: string; name: string }[];
  changes: {
    artist_uid: string;
    field: string;
    before: boolean;
    after: boolean;
  }[];
  impact: {
    artist_count: number;
    filesystem_writes: boolean;
    notifications: boolean;
  };
  reversibility: string;
  source_versions: { observation_id: string; observed_at: string };
  authorization_context: {
    actor_user_id?: number;
    client_id?: string;
    authorization_id?: string;
  };
}
