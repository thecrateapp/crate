// The add/edit destination form model: what the drawer edits and what it sends.
import {
  KIND_LABEL,
  S3_PRESETS,
  s3PresetFor,
  type BackupDestination,
  type BackupKind,
  type BackupProvider,
} from "@/lib/backups";

export interface DestinationDraft {
  kind: BackupKind;
  name: string;
  enabled: boolean;
  /** Text values of the editable, non-system config fields. */
  config: Record<string, string>;
  /** Secrets typed in this session; an empty value keeps the stored one. */
  secrets: Record<string, string>;
  preset: string;
}

/** Config fields Crate sets or the drawer edits with its own controls. */
const NOT_TYPED = new Set(["public_key", "known_hosts"]);

export function editableFields(provider: BackupProvider | undefined) {
  return (provider?.config_fields ?? []).filter(
    (field) => !field.system && !NOT_TYPED.has(field.name),
  );
}

function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

export function newDraft(
  kind: BackupKind,
  provider: BackupProvider | undefined,
  presetId = "r2",
): DestinationDraft {
  const config: Record<string, string> = {};
  for (const field of editableFields(provider))
    config[field.name] = text(field.default);
  let name = KIND_LABEL[kind];
  if (kind === "local") config.path = config.path || "restic";
  if (kind === "s3") {
    const preset = S3_PRESETS.find((p) => p.id === presetId) ?? S3_PRESETS[0]!;
    config.endpoint = preset.endpoint.includes("<") ? "" : preset.endpoint;
    config.region = preset.region;
    config.bucket_lookup = preset.bucketLookup;
    if (preset.id !== "other") name = preset.label;
    return {
      kind,
      name,
      enabled: false,
      config,
      secrets: {},
      preset: preset.id,
    };
  }
  return { kind, name, enabled: false, config, secrets: {}, preset: "" };
}

export function draftFrom(
  destination: BackupDestination,
  provider: BackupProvider | undefined,
): DestinationDraft {
  const config: Record<string, string> = {};
  for (const field of editableFields(provider))
    config[field.name] = text(destination.config[field.name] ?? field.default);
  return {
    kind: destination.kind,
    name: destination.name,
    enabled: destination.enabled,
    config,
    secrets: {},
    preset:
      destination.kind === "s3"
        ? s3PresetFor(destination.config.endpoint).id
        : "",
  };
}

function configPayload(draft: DestinationDraft, provider?: BackupProvider) {
  const out: Record<string, unknown> = {};
  for (const field of editableFields(provider)) {
    const value = (draft.config[field.name] ?? "").trim();
    if (!value) {
      if (field.required) out[field.name] = "";
      else if (field.default != null) out[field.name] = field.default;
      continue;
    }
    out[field.name] = field.name === "port" ? Number(value) : value;
  }
  return out;
}

function secretsPayload(draft: DestinationDraft) {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(draft.secrets))
    if (value.trim()) out[name] = value.trim();
  return out;
}

export function createPayload(
  draft: DestinationDraft,
  provider?: BackupProvider,
) {
  return {
    kind: draft.kind,
    name: draft.name.trim(),
    config: configPayload(draft, provider),
    secrets: secretsPayload(draft),
  };
}

export function probePayload(
  draft: DestinationDraft,
  provider?: BackupProvider,
) {
  return {
    kind: draft.kind,
    config: configPayload(draft, provider),
    secrets: secretsPayload(draft),
  };
}

export function updatePayload(
  draft: DestinationDraft,
  destination: BackupDestination,
  provider?: BackupProvider,
) {
  const body: Record<string, unknown> = {};
  if (draft.name.trim() !== destination.name) body.name = draft.name.trim();
  const config = configPayload(draft, provider);
  const changed = Object.entries(config).filter(
    ([name, value]) => text(value) !== text(destination.config[name]),
  );
  if (changed.length) body.config = Object.fromEntries(changed);
  const secrets = secretsPayload(draft);
  if (Object.keys(secrets).length) body.secrets = secrets;
  if (draft.enabled !== destination.enabled) body.enabled = draft.enabled;
  return body;
}

/** What must be filled before a save or a test can be sent. */
export function missingFields(
  draft: DestinationDraft,
  provider: BackupProvider | undefined,
  destination?: BackupDestination | null,
): string[] {
  const missing: string[] = [];
  if (!draft.name.trim()) missing.push("name");
  for (const field of editableFields(provider))
    if (field.required && !(draft.config[field.name] ?? "").trim())
      missing.push(field.name);
  for (const field of provider?.secret_fields ?? [])
    if (
      field.required &&
      !field.system &&
      !draft.secrets[field.name]?.trim() &&
      !destination?.secrets_set.includes(field.name)
    )
      missing.push(field.name);
  return missing;
}
