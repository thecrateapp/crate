export const permissionLabels: Record<string, string> = {
  "library.health.read": "Inspect library health",
  "library.health.run": "Run selected library health checks",
  "library.repair.photo_flag": "Update an artist's photo flag",
  "library.quality.run": "Refresh library quality evidence",
  "library.repair.run": "Apply reviewed library repairs",
  "library.metadata.write": "Edit library metadata",
  "library.enrichment.run": "Enrich selected library metadata",
  "library.analysis.run": "Schedule track analysis",
  "library.sync.run": "Synchronize selected library albums",
  "library.metadata.export": "Export library metadata",
  "library.metadata.rehydrate": "Import portable metadata",
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
  operation?: string;
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
  targets: {
    artist_uid?: string;
    entity_uid?: string;
    entity_type?: string;
    name?: string;
    scope?: string;
  }[];
  changes: Record<string, unknown>[];
  impact: Record<string, unknown>;
  reversibility: string;
  source_versions: Record<string, unknown>;
  conflicts?: Record<string, unknown>[];
  executable?: boolean;
  authorization_context: {
    actor_user_id?: number;
    client_id?: string;
    authorization_id?: string;
  };
}
