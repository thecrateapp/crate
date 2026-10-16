export interface ShowCandidate {
  item_id: string;
  artist_name?: string | null;
  artist_uid?: string | null;
  date?: string | null;
  local_time?: string | null;
  doors_time?: string | null;
  timezone?: string | null;
  venue?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  country_code?: string | null;
  address_line1?: string | null;
  postal_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  url?: string | null;
  tickets_url?: string | null;
  image_url?: string | null;
  lineup?: string[];
  price_range?: string | null;
  status?: string;
  source_ref?: string | null;
  evidence?: string | null;
  source_draft_id?: string;
  extractor?: string;
  extractor_model?: string;
  existing_show_id?: number | null;
  expected_revision?: number | null;
}

export interface ShowOutcome {
  item_id: string;
  show_id?: number;
  revision?: number;
  status: string;
  code?: string;
}

export interface ShowPlan {
  plan_id: string;
  plan_version: string;
  executable: boolean;
  approval_required?: boolean;
  changes: {
    item_id: string;
    before: Record<string, unknown>;
    after: ShowCandidate;
  }[];
  issues?: {
    item_id: string;
    reason?: string;
    missing?: string[];
    matches?: number[];
    artist_matches?: { artist_uid: string; name: string }[];
  }[];
}

export interface ShowJob {
  job_id: string;
  status: string;
  result?: {
    draft?: ShowDraft & {
      readiness?: {
        configured: boolean;
        model?: string;
        connectivity: string;
        vision: string;
        ocr: { available: boolean; reason?: string };
      };
    };
    plan?: ShowPlan;
    execution?: {
      status: string;
      error?: string;
      error_code?: string;
      draft_id?: string;
      items?: ShowOutcome[];
    };
    verification?: { status: string };
  };
}

export function emptyShow(): ShowCandidate {
  return {
    item_id: crypto.randomUUID(),
    artist_name: "",
    date: "",
    local_time: "",
    venue: "",
    city: "",
  };
}

export function showPayload(candidate: ShowCandidate): ShowCandidate {
  return Object.fromEntries(
    Object.entries(candidate).filter(
      ([, value]) => value !== "" && value !== undefined,
    ),
  ) as ShowCandidate;
}

export interface ShowDraft {
  draft_id?: string;
  raw_text: string;
  candidates: ShowCandidate[];
  coverage: string;
  warnings?: string[];
  truncated?: boolean;
  publication?: Record<string, ShowOutcome>;
}

export function isShowSaved(outcome?: ShowOutcome): boolean {
  return Boolean(
    outcome?.show_id &&
    ["created", "already_exists", "linked_source"].includes(outcome.status),
  );
}
