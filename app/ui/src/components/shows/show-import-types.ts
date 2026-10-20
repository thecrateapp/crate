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
  source_provider?: "manual" | "mcp" | "ticketmaster" | "setlistfm" | "lastfm";
  source_event_id?: string | null;
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

export type ExtractionMethod =
  "ocr" | "parse" | "vision" | "text_llm" | "ocr_text_llm";

export type ModelMethod = Extract<
  ExtractionMethod,
  "vision" | "text_llm" | "ocr_text_llm"
>;

export interface ShowModelAvailability {
  configured: boolean;
  model?: string | null;
  provider?: string | null;
  configuration_fingerprint?: string | null;
  reason?: string | null;
}

export interface ShowAvailability {
  ocr: { available: boolean; reason?: string | null };
  checked_at?: string;
  actions?: Partial<Record<ModelMethod, ShowModelAvailability>>;
}

export interface ShowDraftRow {
  id: string;
  job_id: string;
  status: string;
  mode?: ExtractionMethod | null;
  created_at?: string | null;
  candidate_count?: number | null;
}

export interface ShowPlan {
  plan_id: string;
  plan_version: string;
  executable: boolean;
  approval_required?: boolean;
  kind?: string;
  notices?: string[];
  reversibility?: string;
  changes: {
    item_id: string;
    before: Record<string, unknown>;
    after: ShowCandidate & { source_manifest?: unknown };
  }[];
  issues?: {
    item_id: string;
    reason?: string;
    missing?: string[];
    matches?: number[];
    artist_matches?: { artist_uid: string; name: string }[];
    status?: string;
    related_item_id?: string;
  }[];
}

export interface ShowJob {
  job_id: string;
  status: string;
  result?: {
    draft?: ShowDraft & {
      readiness?: ShowAvailability;
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
  const clearable = new Set([
    "artist_uid",
    "local_time",
    "doors_time",
    "timezone",
    "region",
    "country",
    "country_code",
    "address_line1",
    "postal_code",
    "url",
    "tickets_url",
    "image_url",
    "price_range",
  ]);
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (value === undefined) continue;
    if (value === "") {
      if (candidate.existing_show_id && clearable.has(key)) payload[key] = null;
    } else payload[key] = value;
  }
  return payload as unknown as ShowCandidate;
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
