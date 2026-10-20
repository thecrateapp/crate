import { humanizeKey } from "@/lib/humanize";
import type { StatusTone } from "@/components/admin/StatusBadge";
import type {
  Action,
  AssignmentOutcome,
  Config,
  Connection,
  LegacyConfig,
  Model,
  ModelChoice,
  Profile,
  ReasoningConfig,
  Snapshot,
  Usage,
  Version,
} from "@/components/ai-models/types";

export const FEATURE_AREAS = [
  "shows",
  "artwork",
  "editorial",
  "genres",
  "discovery",
  "translation",
] as const;

const FEATURE_AREA_LABELS: Record<string, string> = {
  shows: "Shows",
  artwork: "Artwork",
  editorial: "Editorial",
  genres: "Genres",
  discovery: "Discovery",
  translation: "Translations",
};

export function featureAreaLabel(group: string): string {
  return FEATURE_AREA_LABELS[group] ?? humanizeKey(group);
}

const FEATURE_SENDS: Record<string, string> = {
  "shows.extract.vision": "Sends: the poster or screenshot",
  "shows.extract.text": "Sends: pasted text or the text of a public page",
  "shows.extract.ocr_text": "Sends: text read by local OCR, never the image",
  "artwork.hero.analyze": "Sends: the artist photo",
  "artists.bio.research": "Sends: collected sources and evidence",
  "genres.description.generate":
    "Sends: the genre, its context and seed artists",
  "genres.taxonomy.propose": "Sends: genres and their current relationships",
  "genres.eq.propose": "Sends: the genre and its context",
  "playlists.description.generate": "Sends: playlist rules and up to 60 tracks",
  "music_paths.refine": "Sends: the computed path and the allowed alternatives",
  "i18n.listen.draft": "Sends: interface text with its keys and placeholders",
};

export function featureSends(action: Action): string {
  return FEATURE_SENDS[action.id] ?? action.description;
}

const PROVIDER_LABELS: Record<string, string> = {
  gemini: "Gemini",
  deepseek: "DeepSeek",
  ollama: "Ollama",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? humanizeKey(provider);
}

export function connectionName(connection: Connection): string {
  if (connection.source === "environment") {
    return `${providerLabel(connection.provider)} from server`;
  }
  return connection.label;
}

export interface ToneView {
  label: string;
  tone: StatusTone;
}

export function providerStatus(connection: Connection): ToneView {
  if (!connection.enabled) return { label: "Turned off", tone: "neutral" };
  if (connection.provider !== "ollama" && !connection.has_key) {
    return { label: "Needs key", tone: "warning" };
  }
  if (connection.catalog_status === "error") {
    return { label: "Error", tone: "danger" };
  }
  if (connection.model_count === 0) {
    return { label: "Models not loaded", tone: "warning" };
  }
  return { label: "Ready", tone: "success" };
}

export function isUsableConnection(connection: Connection): boolean {
  return (
    connection.enabled &&
    connection.persistent_id !== null &&
    connection.model_count > 0 &&
    (connection.provider === "ollama" || connection.has_key)
  );
}

function legacyProvider(snapshot: Snapshot): string | null {
  return snapshot.legacy_actions[0]?.provider ?? null;
}

export function splitConnections(snapshot: Snapshot): {
  shown: Connection[];
  hidden: Connection[];
} {
  const legacy = legacyProvider(snapshot);
  const hidden: Connection[] = [];
  const shown: Connection[] = [];
  for (const connection of snapshot.connections) {
    const isLegacyBeforeMigration =
      connection.provider === legacy && !snapshot.migrated;
    const shouldHide =
      connection.source === "environment" &&
      connection.persistent_id === null &&
      !connection.has_key &&
      !isLegacyBeforeMigration;
    (shouldHide ? hidden : shown).push(connection);
  }
  return { shown, hidden };
}

export const PROVIDER_DEFAULT_REASONING: ReasoningConfig = {
  mode: "provider_default",
  level: null,
  budget_tokens: null,
};

/** The select value of a reasoning config, matching `reasoningPresets`. */
export function reasoningValue(reasoning: ReasoningConfig): string {
  if (reasoning.mode === "level") return `level:${reasoning.level ?? ""}`;
  if (reasoning.mode === "budget") {
    return `budget:${reasoning.budget_tokens ?? 0}`;
  }
  return reasoning.mode;
}

export function reasoningFromValue(value: string): ReasoningConfig {
  if (value.startsWith("level:")) {
    return { mode: "level", level: value.slice(6), budget_tokens: null };
  }
  if (value.startsWith("budget:")) {
    const tokens = Number(value.slice(7));
    if (Number.isInteger(tokens) && tokens > 0) {
      return { mode: "budget", level: null, budget_tokens: tokens };
    }
    return PROVIDER_DEFAULT_REASONING;
  }
  if (value === "enabled" || value === "disabled") {
    return { mode: value, level: null, budget_tokens: null };
  }
  return PROVIDER_DEFAULT_REASONING;
}

/**
 * Whether image features can run on a model or profile version: the server
 * admits an image only when its per-image token bound is known.
 */
function admitsImages(entry: { image_token_bound?: number | null }): boolean {
  return entry.image_token_bound != null;
}

/** Catalog models a connection can run for Crate, optionally for one feature. */
export function eligibleModels(
  models: Model[],
  connection: Connection,
  feature?: Action,
): Model[] {
  return models.filter(
    (model) =>
      model.validated &&
      model.structured_output &&
      model.provider === connection.provider &&
      (feature?.input !== "image" ||
        (model.input_modalities.includes("image") && admitsImages(model))),
  );
}

/** The snapshot connection a stored connection id (public or persistent) refers to. */
export function findConnection(
  snapshot: Snapshot,
  connectionId: string,
): Connection | undefined {
  return snapshot.connections.find(
    (connection) =>
      connection.id === connectionId ||
      connection.persistent_id === connectionId,
  );
}

function usableConnectionId(
  snapshot: Snapshot,
  connectionId: string | null | undefined,
): string | null {
  if (!connectionId) return null;
  const connection = findConnection(snapshot, connectionId);
  return connection && isUsableConnection(connection) ? connection.id : null;
}

/** What «Default model» starts with: the default, else the server's model. */
export function initialDefaultChoice(snapshot: Snapshot): ModelChoice {
  const current = snapshot.default_model;
  if (current) {
    const connectionId = usableConnectionId(snapshot, current.connection_id);
    return connectionId
      ? {
          connectionId,
          modelId: current.model_id,
          reasoning: current.reasoning,
        }
      : {
          connectionId: "",
          modelId: "",
          reasoning: PROVIDER_DEFAULT_REASONING,
        };
  }
  const legacy = snapshot.legacy_actions[0];
  const environment = legacy
    ? snapshot.connections.find(
        (connection) =>
          connection.source === "environment" &&
          connection.provider === legacy.provider &&
          isUsableConnection(connection),
      )
    : undefined;
  if (!legacy || !environment) {
    return {
      connectionId: "",
      modelId: "",
      reasoning: PROVIDER_DEFAULT_REASONING,
    };
  }
  return {
    connectionId: environment.id,
    modelId: legacy.model_id,
    reasoning: PROVIDER_DEFAULT_REASONING,
  };
}

/** What a feature's «Choose a model» starts with: its current connection. */
export function initialFeatureChoice(
  snapshot: Snapshot,
  actionId: string,
): ModelChoice {
  const binding = snapshot.bindings.find(
    (candidate) => candidate.action_id === actionId,
  );
  const version = binding
    ? findVersion(snapshot, binding.profile_id, binding.profile_version)
    : undefined;
  const connectionId =
    usableConnectionId(snapshot, version?.connection_id) ??
    usableConnectionId(snapshot, snapshot.default_model?.connection_id) ??
    "";
  return { connectionId, modelId: "", reasoning: PROVIDER_DEFAULT_REASONING };
}

export interface SavedProfileOption {
  profile: Profile;
  version: Version;
}

/** Each profile's current version a feature can be bound to. */
export function savedProfileOptions(
  snapshot: Snapshot,
  actionId: string,
): SavedProfileOption[] {
  const image =
    snapshot.actions.find((action) => action.id === actionId)?.input ===
    "image";
  const options: SavedProfileOption[] = [];
  for (const profile of snapshot.profiles) {
    const version = profile.versions.find(
      (candidate) => candidate.version === profile.current_version,
    );
    if (!version) continue;
    if ("kind" in version.config) {
      // A kept server-settings snapshot only ever runs its own feature.
      if (version.config.action_id !== actionId) continue;
    } else if (image && !admitsImages(version)) {
      continue;
    }
    options.push({ profile, version });
  }
  return options;
}

function featureCount(n: number): string {
  return `${formatCount(n)} ${n === 1 ? "feature" : "features"}`;
}

function staysOffText(
  outcomes: AssignmentOutcome[],
  actions: Pick<Action, "id" | "label">[],
): string {
  const off = outcomes.filter(staysOffAfterApply);
  if (off.length === 0) return "";
  const labels = off.map(
    (outcome) =>
      actions.find((action) => action.id === outcome.action_id)?.label,
  );
  if (off.length === 1 && labels[0]) {
    return ` ${labels[0]} stays off. Turn it on in Features.`;
  }
  if (off.length === 2 && labels[0] && labels[1]) {
    return ` ${labels[0]} and ${labels[1]} stay off. Turn them on in Features.`;
  }
  return ` ${formatCount(off.length)} stay off. Turn them on in Features.`;
}

/** The toast description after «Use for all features»: only what will run. */
export function assignmentSummary(
  modelId: string,
  outcomes: AssignmentOutcome[],
  actions: Pick<Action, "id" | "label">[],
): string {
  const groups = outcomeGroups(outcomes);
  const kept =
    groups.kept > 0
      ? ` ${formatCount(groups.kept)} kept their current model.`
      : "";
  const turnedOff =
    groups.turnedOff > 0 ? ` ${formatCount(groups.turnedOff)} turned off.` : "";
  return `${modelId} now runs ${featureCount(groups.uses)}.${kept}${turnedOff}${staysOffText(
    outcomes,
    actions,
  )}`;
}

export interface ReasoningPreset {
  value: string;
  label: string;
}

export function reasoningPresets(model: Model): ReasoningPreset[] {
  const presets: ReasoningPreset[] = [
    { value: "provider_default", label: "Provider default" },
  ];
  if (model.reasoning_disabled) {
    presets.push({ value: "disabled", label: "Off" });
  }
  if (model.reasoning_enabled) {
    presets.push({ value: "enabled", label: "On" });
  }
  for (const level of model.reasoning_levels) {
    presets.push({ value: `level:${level}`, label: humanizeKey(level) });
  }
  if (model.thinking_budget_min != null && model.thinking_budget_max != null) {
    const upper = Math.min(model.thinking_budget_max, 16000);
    const lower = model.thinking_budget_min;
    const clamp = (n: number) => Math.max(lower, Math.min(n, upper));
    const budgets = Array.from(new Set([clamp(1024), clamp(8192)]));
    for (const tokens of budgets) {
      presets.push({
        value: `budget:${tokens}`,
        label: reasoningLabel({
          mode: "budget",
          level: null,
          budget_tokens: tokens,
        }),
      });
    }
  }
  return presets;
}

export function reasoningLabel(reasoning: ReasoningConfig): string {
  switch (reasoning.mode) {
    case "provider_default":
      return "Provider default";
    case "disabled":
      return "Off";
    case "enabled":
      return "On";
    case "level":
      return humanizeKey(reasoning.level ?? "");
    case "budget":
      return `Thinking: ${formatCount(reasoning.budget_tokens ?? 0)} tokens`;
    default:
      return "Provider default";
  }
}

const IMAGE_DETAIL_LABELS: Record<string, string> = {
  default: "Standard",
  high: "High",
  ultra_high: "Very high",
};

export function imageDetailLabel(detail: string): string {
  return IMAGE_DETAIL_LABELS[detail] ?? humanizeKey(detail);
}

export function configSummary(config: Config | LegacyConfig): string {
  if ("kind" in config) return "Kept from server settings";
  return `Reasoning: ${reasoningLabel(config.reasoning)} · Image detail: ${imageDetailLabel(
    config.image_detail,
  )} · Up to ${config.timeout_seconds} s · ${formatCount(
    config.max_output_tokens,
  )} output tokens`;
}

const REASON_TEXT: Record<string, string> = {
  AI_ACTION_NEEDS_IMAGE: "Needs a model that reads images",
  AI_IMAGE_BOUND_UNKNOWN: "This model's image limits are unknown",
  AI_CONTEXT_TOO_SMALL: "The model's context window is too small",
  AI_MODEL_UNVALIDATED: "Its provider's models need a refresh",
  AI_LEGACY_LIMITS_UNKNOWN: "Its model's limits are unknown",
  AI_CREDENTIAL_REQUIRED: "No API key for its provider",
  AI_PROVIDER_UNSUPPORTED: "Its provider is not supported",
  AI_PROFILE_INCOMPATIBLE: "Not compatible with this model",
  AI_ACTION_DISABLED: "Turned off",
  AI_CONNECTION_UNAVAILABLE: "Its connection is turned off or was removed",
  AI_MODEL_INCOMPATIBLE: "The model can't run Crate's features",
  AI_CONFIGURATION_INVALID: "Its saved settings can't be read",
};

export function reasonText(code: string | null): string {
  if (!code) return "Not available";
  return REASON_TEXT[code] ?? "Not available";
}

const AI_ERROR_TEXT: Record<string, string> = {
  AI_CONFIGURATION_CONFLICT:
    "AI settings changed while you were editing. Review and try again.",
  AI_CONTEXT_STALE:
    "AI settings changed while you were editing. Review and try again.",
  AI_SETUP_BLOCKED:
    "Some features can't keep their current model. Choose another model or refresh the server provider's models.",
  AI_MODEL_INCOMPATIBLE: "This model can't run the selected features.",
  AI_CREDENTIAL_REQUIRED: "This connection needs an API key.",
  AI_CONNECTION_UNAVAILABLE: "This connection is turned off.",
  AI_MODEL_UNVALIDATED: "Refresh this connection's models first.",
  AI_PROFILE_INCOMPATIBLE: "This model doesn't support these options.",
  AI_CREDENTIAL_STORAGE:
    "Saving keys needs CRATE_CREDENTIAL_KEY on the server.",
  AI_ENVIRONMENT_READ_ONLY:
    "Keys from the server environment can't be changed here.",
  AI_ENDPOINT_INVALID: "This address isn't a valid model server URL.",
  AI_PROVIDER_UNSUPPORTED: "This provider isn't supported.",
  AI_IMAGE_BOUND_UNKNOWN:
    "This model's image limits are unknown, so it can't run image features.",
  AI_ACTION_NEEDS_IMAGE: "This feature needs a model that reads images.",
};

const DEFAULT_AI_ERROR_TEXT =
  "AI settings could not be saved. Reload and try again.";

/**
 * Readable copy for a failed AI write. `invalidRequestText` names what the
 * form sent, for a 422 the API rejects without a code (request validation).
 */
export function aiErrorText(
  error: unknown,
  invalidRequestText?: string,
): string {
  const { code, status } =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown; status?: unknown })
      : { code: undefined, status: undefined };
  if (typeof code === "string") {
    return AI_ERROR_TEXT[code] ?? DEFAULT_AI_ERROR_TEXT;
  }
  if (status === 422 && invalidRequestText) return invalidRequestText;
  return DEFAULT_AI_ERROR_TEXT;
}

/** A write lost a compare-and-set race: refetch before trying again. */
export function isConflictError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, status } = error as { code?: unknown; status?: unknown };
  return (
    status === 409 ||
    code === "AI_CONFIGURATION_CONFLICT" ||
    code === "AI_CONTEXT_STALE"
  );
}

/** A cleared number input reads as NaN; render it as an empty field. */
export function numberInputValue(value: number): number | "" {
  return Number.isFinite(value) ? value : "";
}

// Codes a single model call can end with. Configuration codes fall back to
// the reason and settings copy; anything else reads as a plain failure, never
// as the save-oriented default of aiErrorText.
const INVOCATION_ERROR_TEXT: Record<string, string> = {
  AI_PROVIDER_TIMEOUT: "The provider didn't answer in time",
  AI_PROVIDER_FAILED: "The provider couldn't complete the request",
  AI_RESPONSE_INVALID: "The model's answer didn't match the expected format",
  AI_INPUT_TOO_LARGE: "The input was larger than the profile allows",
  AI_PROBE_FAILED: "The test request failed",
};

export function invocationErrorText(code: string): string {
  return (
    INVOCATION_ERROR_TEXT[code] ??
    REASON_TEXT[code] ??
    AI_ERROR_TEXT[code] ??
    "The call failed"
  );
}

function findVersion(
  snapshot: Snapshot,
  profileId: string,
  version: number,
): Version | undefined {
  return snapshot.profiles
    .find((profile) => profile.id === profileId)
    ?.versions.find((v) => v.version === version);
}

export function summaryModel(snapshot: Snapshot): string {
  const current = snapshot.default_model;
  if (current?.available && current.model_id !== "unknown") {
    return current.model_id;
  }
  const counts = new Map<string, number>();
  for (const binding of snapshot.bindings) {
    if (!binding.enabled) continue;
    const version = findVersion(
      snapshot,
      binding.profile_id,
      binding.profile_version,
    );
    if (!version) continue;
    counts.set(version.model_id, (counts.get(version.model_id) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [modelId, count] of counts) {
    if (count > bestCount) {
      best = modelId;
      bestCount = count;
    }
  }
  if (best) return best;
  if (snapshot.legacy_actions[0]) return snapshot.legacy_actions[0].model_id;
  return "No model";
}

export function activeFeatureCount(snapshot: Snapshot): number {
  if (snapshot.migrated) {
    return snapshot.bindings.filter((binding) => binding.enabled).length;
  }
  return snapshot.legacy_actions.filter(
    (action) => action.supported && action.legacy_enabled !== false,
  ).length;
}

export interface FeatureModelView {
  label: string;
  tone: StatusTone;
  model: string | null;
}

export function featureModelView(
  snapshot: Snapshot,
  actionId: string,
): FeatureModelView {
  if (!snapshot.migrated) {
    const legacy = snapshot.legacy_actions.find(
      (action) => action.action_id === actionId,
    );
    return {
      label: "Server settings",
      tone: "neutral",
      model: legacy?.model_id ?? null,
    };
  }
  const binding = snapshot.bindings.find(
    (candidate) => candidate.action_id === actionId,
  );
  if (!binding) return { label: "Not set", tone: "warning", model: null };
  const version = findVersion(
    snapshot,
    binding.profile_id,
    binding.profile_version,
  );
  if (version && "kind" in version.config) {
    return {
      label: "Server settings",
      tone: "neutral",
      model: version.model_id,
    };
  }
  const model = version?.model_id ?? null;
  const feature = snapshot.default_model?.features.find(
    (candidate) => candidate.action_id === actionId,
  );
  if (feature?.status === "default") {
    return { label: "Default", tone: "info", model };
  }
  if (feature?.status === "incompatible") {
    return { label: "Current model", tone: "neutral", model };
  }
  return { label: "Override", tone: "neutral", model };
}

/**
 * Connections whose limits start to apply when an assignment activates: the
 * chosen one, plus each connection that keeps serving a feature (the server
 * provider behind kept settings, or a feature's current binding).
 */
export function limitedConnections(
  snapshot: Snapshot,
  chosen: Connection,
  outcomes: AssignmentOutcome[],
): Connection[] {
  const found: Connection[] = [];
  const add = (connection: Connection | undefined) => {
    if (!connection) return;
    const key = connection.persistent_id ?? connection.id;
    if (found.some((seen) => (seen.persistent_id ?? seen.id) === key)) return;
    found.push(connection);
  };
  if (
    outcomes.some(
      (outcome) =>
        outcome.outcome === "applied" || outcome.outcome === "unchanged",
    )
  ) {
    add(chosen);
  }
  for (const outcome of outcomes) {
    if (outcome.outcome === "kept_legacy") {
      const legacy = snapshot.legacy_actions.find(
        (action) => action.action_id === outcome.action_id,
      );
      add(
        legacy
          ? snapshot.connections.find(
              (connection) =>
                connection.source === "environment" &&
                connection.provider === legacy.provider,
            )
          : undefined,
      );
    } else if (outcome.outcome === "kept_current") {
      const binding = snapshot.bindings.find(
        (candidate) => candidate.action_id === outcome.action_id,
      );
      const version = binding
        ? findVersion(snapshot, binding.profile_id, binding.profile_version)
        : undefined;
      add(
        version ? findConnection(snapshot, version.connection_id) : undefined,
      );
    }
  }
  return found;
}

export interface UsageTodayTotals {
  calls: number;
  tokens: number;
  failed: number;
}

export function usageToday(usage: Usage, now: Date): UsageTodayTotals {
  const today = now.toISOString().slice(0, 10);
  const totals: UsageTodayTotals = { calls: 0, tokens: 0, failed: 0 };
  for (const row of usage.daily) {
    if (row.day !== today) continue;
    totals.calls += row.calls;
    totals.tokens += row.tokens;
    totals.failed += row.failed;
  }
  return totals;
}

export function dailyTokenBudget(snapshot: Snapshot): number | null {
  if (!snapshot.migrated) return null;
  const seen = new Set<string>();
  let total = 0;
  for (const binding of snapshot.bindings) {
    if (!binding.enabled) continue;
    const version = findVersion(
      snapshot,
      binding.profile_id,
      binding.profile_version,
    );
    if (!version) continue;
    const connection = findConnection(snapshot, version.connection_id);
    if (!connection) continue;
    const key = connection.persistent_id ?? connection.id;
    if (seen.has(key)) continue;
    seen.add(key);
    total += connection.daily_tokens;
  }
  return total;
}

export interface DailyUsagePoint {
  day: string;
  Completed: number;
  Failed: number;
  tokens: number;
}

export function dailyUsageSeries(
  usage: Usage,
  days = 30,
  now: Date = new Date(),
): DailyUsagePoint[] {
  const byDay = new Map<
    string,
    { Completed: number; Failed: number; tokens: number }
  >();
  for (const row of usage.daily) {
    const bucket = byDay.get(row.day) ?? {
      Completed: 0,
      Failed: 0,
      tokens: 0,
    };
    bucket.Completed += row.completed;
    bucket.Failed += row.failed;
    bucket.tokens += row.tokens;
    byDay.set(row.day, bucket);
  }
  const series: DailyUsagePoint[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - offset);
    const day = date.toISOString().slice(0, 10);
    const bucket = byDay.get(day);
    series.push({
      day,
      Completed: bucket?.Completed ?? 0,
      Failed: bucket?.Failed ?? 0,
      tokens: bucket?.tokens ?? 0,
    });
  }
  return series;
}

const INVOCATION_STATUS: Record<string, ToneView> = {
  succeeded: { label: "Succeeded", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  timeout: { label: "Timed out", tone: "danger" },
  reserved: { label: "Running", tone: "info" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function invocationStatusView(status: string): ToneView {
  return (
    INVOCATION_STATUS[status] ?? { label: humanizeKey(status), tone: "neutral" }
  );
}

export function formatTokens(invocation: {
  input_tokens: number | null;
  output_tokens: number | null;
}): string {
  if (invocation.input_tokens == null && invocation.output_tokens == null) {
    return "Unknown";
  }
  const input =
    invocation.input_tokens != null
      ? formatCount(invocation.input_tokens)
      : "?";
  const output =
    invocation.output_tokens != null
      ? formatCount(invocation.output_tokens)
      : "?";
  return `${input} in · ${output} out`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes} min ${seconds} s`;
}

export function formatCount(n: number): string {
  return n.toLocaleString("en");
}

export interface OutcomeGroups {
  uses: number;
  staysOff: number;
  kept: number;
  turnedOff: number;
  blocked: number;
}

/**
 * The feature takes the model but its switch stays off: setup never turns a
 * feature on that is off now.
 */
export function staysOffAfterApply(outcome: AssignmentOutcome): boolean {
  return (
    (outcome.outcome === "applied" || outcome.outcome === "unchanged") &&
    outcome.enabled === false
  );
}

export function outcomeGroups(outcomes: AssignmentOutcome[]): OutcomeGroups {
  const groups: OutcomeGroups = {
    uses: 0,
    staysOff: 0,
    kept: 0,
    turnedOff: 0,
    blocked: 0,
  };
  for (const outcome of outcomes) {
    if (staysOffAfterApply(outcome)) {
      groups.staysOff += 1;
    } else if (
      outcome.outcome === "applied" ||
      outcome.outcome === "unchanged"
    ) {
      groups.uses += 1;
    } else if (
      outcome.outcome === "kept_legacy" ||
      outcome.outcome === "kept_current"
    ) {
      groups.kept += 1;
    } else if (outcome.outcome === "turned_off") {
      groups.turnedOff += 1;
    } else if (outcome.outcome === "blocked") {
      groups.blocked += 1;
    }
  }
  return groups;
}
