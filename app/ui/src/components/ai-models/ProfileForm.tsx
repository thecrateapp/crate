import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { Button } from "@crate/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@crate/ui/shadcn/dialog";
import { Input } from "@crate/ui/shadcn/input";
import { FormField } from "@crate/ui/primitives/FormField";

import { AdminSelect } from "@/components/ui";
import {
  findConnection,
  imageDetailLabel,
  isConflictError,
  isUsableConnection,
  numberInputValue,
  PROVIDER_DEFAULT_REASONING,
} from "@/lib/ai-models";

import { reportFailure, writeAI } from "./api";
import { ModelPicker, type ModelChoice } from "./ModelPicker";
import type { Config, Model, Profile, Snapshot, Version } from "./types";

const CONFLICT_TEXT =
  "AI settings changed while you were editing. Review and try again.";

// The same ceilings the API enforces for every profile.
const MAX_TIMEOUT_SECONDS = 90;
const MAX_OUTPUT_TOKENS = 16000;
const MAX_INPUT_TOKENS = 131072;

const DEFAULT_LIMITS = {
  image_detail: "default",
  timeout_seconds: 45,
  max_output_tokens: 2048,
  max_input_tokens: 16384,
};

type Limits = Omit<Config, "reasoning">;

function outputCeiling(model: Model | null): number {
  return Math.min(
    MAX_OUTPUT_TOKENS,
    model?.max_output_tokens ?? MAX_OUTPUT_TOKENS,
  );
}

/** Input and output together must fit in the model's context window. */
function inputCeiling(model: Model | null, outputTokens: number): number {
  const window =
    model?.context_window != null
      ? model.context_window -
        (Number.isFinite(outputTokens) ? outputTokens : 0)
      : MAX_INPUT_TOKENS;
  return Math.max(1, Math.min(MAX_INPUT_TOKENS, window));
}

/** Keep the operator's limits, but within what the new model accepts. */
function fitLimits(limits: Limits, model: Model | null): Limits {
  if (!model) return limits;
  const imageDetail = model.image_details.includes(limits.image_detail)
    ? limits.image_detail
    : model.image_details.includes("default")
      ? "default"
      : (model.image_details[0] ?? "default");
  const output = Math.min(limits.max_output_tokens, outputCeiling(model));
  return {
    image_detail: imageDetail,
    timeout_seconds: limits.timeout_seconds,
    max_output_tokens: output,
    max_input_tokens: Math.min(
      limits.max_input_tokens,
      inputCeiling(model, output),
    ),
  };
}

function currentVersion(profile: Profile): Version | undefined {
  return profile.versions.find(
    (version) => version.version === profile.current_version,
  );
}

function initialState(
  snapshot: Snapshot,
  profile: Profile | null,
): { choice: ModelChoice; limits: Limits } {
  const version = profile ? currentVersion(profile) : undefined;
  if (!version) {
    return {
      choice: {
        connectionId: "",
        modelId: "",
        reasoning: PROVIDER_DEFAULT_REASONING,
      },
      limits: DEFAULT_LIMITS,
    };
  }
  const connection = findConnection(snapshot, version.connection_id);
  const connectionId =
    connection && isUsableConnection(connection) ? connection.id : "";
  if ("kind" in version.config) {
    const legacy = version.config.legacy_options;
    return {
      choice: {
        connectionId,
        modelId: connectionId ? version.model_id : "",
        reasoning: PROVIDER_DEFAULT_REASONING,
      },
      limits: {
        image_detail: legacy.image_detail,
        timeout_seconds: Math.min(
          legacy.timeout_seconds ?? DEFAULT_LIMITS.timeout_seconds,
          MAX_TIMEOUT_SECONDS,
        ),
        max_output_tokens: Math.min(
          legacy.max_tokens ?? DEFAULT_LIMITS.max_output_tokens,
          MAX_OUTPUT_TOKENS,
        ),
        max_input_tokens: DEFAULT_LIMITS.max_input_tokens,
      },
    };
  }
  const { reasoning, ...limits } = version.config;
  return {
    choice: {
      connectionId,
      modelId: connectionId ? version.model_id : "",
      reasoning: connectionId ? reasoning : PROVIDER_DEFAULT_REASONING,
    },
    limits,
  };
}

function withinBounds(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= max;
}

export function ProfileForm({
  snapshot,
  profile: givenProfile,
  open,
  onOpenChange,
  refresh,
}: {
  snapshot: Snapshot;
  /** The profile to add a version to, as in the latest snapshot; null for a new profile. */
  profile: Profile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refresh: () => void;
}) {
  const checkboxId = useId();
  const [profile] = useState(givenProfile);
  const [initial] = useState(() => initialState(snapshot, profile));
  // The version being replaced is fixed when the form opens, so a newer
  // snapshot cannot silently move expected_version over a concurrent change.
  // Only after a conflict does the form adopt the refreshed current version.
  const [expectedVersion, setExpectedVersion] = useState(
    profile?.current_version ?? 0,
  );
  const [conflictedAt, setConflictedAt] = useState<Snapshot | null>(null);
  const [conflicted, setConflicted] = useState(false);
  if (conflictedAt && snapshot !== conflictedAt) {
    setConflictedAt(null);
    if (givenProfile) setExpectedVersion(givenProfile.current_version);
  }
  const [name, setName] = useState("");
  const [choice, setChoice] = useState<ModelChoice>(initial.choice);
  const [model, setModel] = useState<Model | null>(null);
  const [limits, setLimits] = useState<Limits>(initial.limits);
  const [reviewed, setReviewed] = useState(false);
  const [modelChanged, setModelChanged] = useState(false);
  const [busy, setBusy] = useState(false);

  const connection =
    snapshot.connections.find(
      (candidate) => candidate.id === choice.connectionId,
    ) ?? null;
  const outputMax = outputCeiling(model);
  const inputMax = inputCeiling(model, limits.max_output_tokens);
  const limitsValid =
    model !== null &&
    model.image_details.includes(limits.image_detail) &&
    withinBounds(limits.timeout_seconds, MAX_TIMEOUT_SECONDS) &&
    withinBounds(limits.max_output_tokens, outputMax) &&
    withinBounds(limits.max_input_tokens, inputMax);
  const ready =
    connection?.persistent_id != null &&
    model !== null &&
    model.model_id === choice.modelId &&
    limitsValid &&
    reviewed &&
    conflictedAt === null &&
    (profile !== null || name.trim() !== "");

  function changeChoice(next: ModelChoice, nextModel: Model | null) {
    if (next.modelId !== choice.modelId) {
      if (choice.modelId) setModelChanged(true);
      setReviewed(false);
      setLimits((current) => fitLimits(current, nextModel));
    }
    setChoice(next);
    setModel(nextModel);
  }

  function setLimit(key: keyof Omit<Limits, "image_detail">, value: number) {
    setLimits((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || !connection?.persistent_id) return;
    const body = {
      connection_id: connection.persistent_id,
      model_id: choice.modelId,
      config: { reasoning: choice.reasoning, ...limits },
    };
    setBusy(true);
    setConflicted(false);
    try {
      if (profile) {
        await writeAI(`/profiles/${encodeURIComponent(profile.id)}/versions`, {
          ...body,
          expected_version: expectedVersion,
        });
        toast.success(`New version of ${profile.label} saved`);
      } else {
        await writeAI("/profiles", { label: name.trim(), ...body });
        toast.success(`${name.trim()} created`);
      }
      onOpenChange(false);
    } catch (error) {
      if (isConflictError(error)) {
        // Keep what was entered; wait for the refreshed profile, then ask for
        // a fresh review before saving over the newer version.
        setConflicted(true);
        setConflictedAt(snapshot);
        setReviewed(false);
      } else {
        reportFailure(error);
      }
    } finally {
      setBusy(false);
      refresh();
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">
            {profile ? `New version of ${profile.label}` : "New profile"}
          </DialogTitle>
          <DialogDescription>
            Saving a profile doesn&apos;t change any feature.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          {profile ? null : (
            <FormField label="Name" className="min-w-0">
              <Input
                required
                maxLength={200}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
          )}

          <ModelPicker
            snapshot={snapshot}
            value={choice}
            onChange={changeChoice}
            onModelResolved={setModel}
            disabled={busy}
          />

          <FormField label="Image detail">
            <AdminSelect
              ariaLabel="Image detail"
              placeholder="Image detail"
              allowClear={false}
              value={model ? limits.image_detail : ""}
              options={(model?.image_details ?? []).map((detail) => ({
                value: detail,
                label: imageDetailLabel(detail),
              }))}
              disabled={busy || !model}
              onChange={(detail) =>
                setLimits((current) => ({ ...current, image_detail: detail }))
              }
            />
          </FormField>

          <div className="grid min-w-0 gap-3 sm:grid-cols-3">
            <FormField label="Time limit (seconds)" className="min-w-0">
              <Input
                type="number"
                required
                min={1}
                max={MAX_TIMEOUT_SECONDS}
                value={numberInputValue(limits.timeout_seconds)}
                onChange={(event) =>
                  setLimit("timeout_seconds", event.target.valueAsNumber)
                }
              />
            </FormField>
            <FormField label="Output tokens" className="min-w-0">
              <Input
                type="number"
                required
                min={1}
                max={outputMax}
                value={numberInputValue(limits.max_output_tokens)}
                onChange={(event) =>
                  setLimit("max_output_tokens", event.target.valueAsNumber)
                }
              />
            </FormField>
            <FormField label="Input tokens" className="min-w-0">
              <Input
                type="number"
                required
                min={1}
                max={inputMax}
                value={numberInputValue(limits.max_input_tokens)}
                onChange={(event) =>
                  setLimit("max_input_tokens", event.target.valueAsNumber)
                }
              />
            </FormField>
          </div>

          {conflicted ? (
            <p role="alert" className="text-sm text-state-warning-text">
              {CONFLICT_TEXT}
            </p>
          ) : null}

          {model && !limitsValid ? (
            <p className="text-sm text-state-warning-text">
              Choose an image detail and limits this model accepts.
            </p>
          ) : null}

          {modelChanged && !reviewed ? (
            <p className="text-sm text-state-warning-text">
              Model changed. Review its options and limits before saving.
            </p>
          ) : null}

          <div className="flex items-start gap-3">
            <Checkbox
              id={checkboxId}
              className="mt-0.5"
              checked={reviewed}
              disabled={busy}
              onCheckedChange={(checked) => setReviewed(checked === true)}
            />
            <label htmlFor={checkboxId} className="text-sm text-text-secondary">
              I reviewed this model&apos;s options and limits
            </label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !ready}>
              {profile ? "Save new version" : "Create profile"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
