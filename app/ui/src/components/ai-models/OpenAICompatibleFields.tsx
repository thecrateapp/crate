import { Trash2 } from "@crate/ui/icons";
import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";

import { AdminSelect } from "@/components/ui";
import {
  OPENAI_COMPATIBLE_PATH_PREFIXES,
  OPENAI_COMPATIBLE_TEMPLATES,
  reasoningControlLabel,
} from "@/lib/ai-models";

import type {
  ManifestEntry,
  OpenAICompatibleTemplate,
  ReasoningControl,
} from "./types";

export interface ModelDraft {
  key: number;
  modelId: string;
  contextWindow: string;
  maxOutput: string;
  structuredOutput: "" | ManifestEntry["structured_output"];
  reasoning: ReasoningControl;
  levels: string;
}

export interface CompatibleDraft {
  template: "" | OpenAICompatibleTemplate;
  address: string;
  pathPrefix: string;
  /** The address the admin confirmed; editing the address withdraws it. */
  confirmedAddress: string | null;
  models: ModelDraft[];
}

let nextKey = 1;

export function emptyModel(): ModelDraft {
  return {
    key: nextKey++,
    modelId: "",
    contextWindow: "",
    maxOutput: "",
    structuredOutput: "",
    reasoning: "none",
    levels: "",
  };
}

export function emptyCompatibleDraft(): CompatibleDraft {
  return {
    template: "",
    address: "",
    pathPrefix: "",
    confirmedAddress: null,
    models: [emptyModel()],
  };
}

// The limits crate.ai.contracts.ModelManifestEntry accepts.
const MAX_CONTEXT = 16777216;
const MAX_OUTPUT = 2097152;
const MAX_MODELS = 50;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const LEVEL = /^[a-z][a-z0-9_]{0,23}$/;
const LEVEL_CONTROLS: readonly ReasoningControl[] = [
  "reasoning_effort",
  "reasoning",
];

function levelsOf(text: string): string[] {
  return text
    .split(",")
    .map((level) => level.trim())
    .filter(Boolean);
}

function whole(text: string, max: number): number | null {
  const value = Number(text);
  return text !== "" && Number.isInteger(value) && value >= 1 && value <= max
    ? value
    : null;
}

/** The manifest entry a draft declares, or null while it is incomplete. */
function manifestEntry(
  draft: ModelDraft,
  controls: readonly ReasoningControl[],
): ManifestEntry | null {
  const context = whole(draft.contextWindow, MAX_CONTEXT);
  const output = whole(draft.maxOutput, MAX_OUTPUT);
  const levels = LEVEL_CONTROLS.includes(draft.reasoning)
    ? levelsOf(draft.levels)
    : [];
  const id = draft.modelId;
  if (
    !MODEL_ID.test(id) ||
    id.length > 200 ||
    id.includes("..") ||
    id.includes("//") ||
    context === null ||
    output === null ||
    output > context ||
    draft.structuredOutput === "" ||
    !controls.includes(draft.reasoning) ||
    (draft.reasoning === "reasoning_effort" && levels.length === 0) ||
    levels.length > 16 ||
    new Set(levels).size !== levels.length ||
    !levels.every((level) => LEVEL.test(level))
  ) {
    return null;
  }
  return {
    model_id: id,
    context_window: context,
    max_output_tokens: output,
    structured_output: draft.structuredOutput,
    reasoning: draft.reasoning,
    reasoning_levels: levels,
  };
}

/** The connection fields to send, or null while the draft is incomplete. */
export function compatibleRequest(
  draft: CompatibleDraft,
): Record<string, unknown> | null {
  if (draft.template === "") return null;
  const template = OPENAI_COMPATIBLE_TEMPLATES[draft.template];
  const manifest = draft.models.map((model) =>
    manifestEntry(model, template.reasoning),
  );
  const ids = new Set(manifest.map((entry) => entry?.model_id));
  if (
    manifest.length === 0 ||
    manifest.some((entry) => entry === null) ||
    ids.size !== manifest.length
  ) {
    return null;
  }
  if (template.origin !== null) {
    return {
      endpoint: null,
      template: draft.template,
      model_manifest: manifest,
    };
  }
  if (
    !draft.address ||
    !draft.pathPrefix ||
    draft.confirmedAddress !== draft.address
  ) {
    return null;
  }
  return {
    endpoint: draft.address,
    template: draft.template,
    path_prefix: draft.pathPrefix,
    confirm_custom_origin: true,
    model_manifest: manifest,
  };
}

const TEMPLATE_OPTIONS = (
  Object.keys(OPENAI_COMPATIBLE_TEMPLATES) as OpenAICompatibleTemplate[]
).map((template) => ({
  value: template,
  label: OPENAI_COMPATIBLE_TEMPLATES[template].label,
}));

const STRUCTURED_OUTPUT_OPTIONS = [
  { value: "json_schema", label: "JSON schema" },
  { value: "json_object", label: "JSON object" },
];

function ModelFields({
  draft,
  index,
  controls,
  removable,
  disabled,
  onChange,
  onRemove,
}: {
  draft: ModelDraft;
  index: number;
  controls: readonly ReasoningControl[];
  removable: boolean;
  disabled: boolean;
  onChange: (changes: Partial<ModelDraft>) => void;
  onRemove: () => void;
}) {
  const name = `Model ${index + 1}`;
  return (
    <fieldset
      aria-label={name}
      className="space-y-3 rounded-md border border-border-quiet p-3"
    >
      <div className="flex items-end gap-2">
        <FormField label="Model ID" className="min-w-0 flex-1">
          <Input
            required
            maxLength={200}
            spellCheck={false}
            value={draft.modelId}
            disabled={disabled}
            onChange={(event) => onChange({ modelId: event.target.value })}
          />
        </FormField>
        {removable ? (
          <ActionIconButton
            title="Remove"
            aria-label={`Remove model ${index + 1}`}
            disabled={disabled}
            onClick={onRemove}
          >
            <Trash2 aria-hidden />
          </ActionIconButton>
        ) : null}
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <FormField label="Context window" className="min-w-0">
          <Input
            type="number"
            required
            min={1}
            max={MAX_CONTEXT}
            value={draft.contextWindow}
            disabled={disabled}
            onChange={(event) =>
              onChange({ contextWindow: event.target.value })
            }
          />
        </FormField>
        <FormField label="Max output" className="min-w-0">
          <Input
            type="number"
            required
            min={1}
            max={MAX_OUTPUT}
            value={draft.maxOutput}
            disabled={disabled}
            onChange={(event) => onChange({ maxOutput: event.target.value })}
          />
        </FormField>
        <FormField label="Structured output" className="min-w-0">
          <AdminSelect
            ariaLabel="Structured output"
            placeholder="Choose"
            allowClear={false}
            value={draft.structuredOutput}
            options={STRUCTURED_OUTPUT_OPTIONS}
            disabled={disabled}
            onChange={(value) =>
              onChange({
                structuredOutput: value as ModelDraft["structuredOutput"],
              })
            }
          />
        </FormField>
        <FormField label="Reasoning" className="min-w-0">
          <AdminSelect
            ariaLabel="Reasoning"
            placeholder="Reasoning"
            allowClear={false}
            value={draft.reasoning}
            options={controls.map((control) => ({
              value: control,
              label: reasoningControlLabel(control),
            }))}
            disabled={disabled}
            onChange={(value) =>
              onChange({ reasoning: value as ReasoningControl })
            }
          />
        </FormField>
      </div>
      {LEVEL_CONTROLS.includes(draft.reasoning) ? (
        <FormField
          label="Reasoning levels"
          hint="Comma separated, exactly as the provider documents them."
        >
          <Input
            placeholder="low, high, max"
            spellCheck={false}
            value={draft.levels}
            disabled={disabled}
            onChange={(event) => onChange({ levels: event.target.value })}
          />
        </FormField>
      ) : null}
    </fieldset>
  );
}

export function OpenAICompatibleFields({
  draft,
  disabled,
  onChange,
}: {
  draft: CompatibleDraft;
  disabled: boolean;
  onChange: (draft: CompatibleDraft) => void;
}) {
  const template =
    draft.template === "" ? null : OPENAI_COMPATIBLE_TEMPLATES[draft.template];
  const controls = template?.reasoning ?? ["none"];

  function chooseTemplate(value: OpenAICompatibleTemplate) {
    const allowed = OPENAI_COMPATIBLE_TEMPLATES[value].reasoning;
    onChange({
      ...draft,
      template: value,
      // A control the new provider lacks falls back to its default.
      models: draft.models.map((model) =>
        allowed.includes(model.reasoning)
          ? model
          : { ...model, reasoning: "none", levels: "" },
      ),
    });
  }

  function changeModel(key: number, changes: Partial<ModelDraft>) {
    onChange({
      ...draft,
      models: draft.models.map((model) =>
        model.key === key ? { ...model, ...changes } : model,
      ),
    });
  }

  return (
    <div className="space-y-4">
      <FormField label="Origin">
        <AdminSelect
          ariaLabel="Origin"
          placeholder="Choose a provider"
          allowClear={false}
          value={draft.template}
          options={TEMPLATE_OPTIONS}
          disabled={disabled}
          onChange={(value) =>
            chooseTemplate(value as OpenAICompatibleTemplate)
          }
        />
      </FormField>

      {template?.origin ? (
        <p className="text-sm text-text-secondary">
          Requests go to{" "}
          <span className="font-mono text-text-primary">
            {`${template.origin}${template.pathPrefix}`}
          </span>
        </p>
      ) : null}

      {template && template.origin === null ? (
        <div className="space-y-3">
          <div className="grid min-w-0 gap-3 sm:grid-cols-[1fr_auto]">
            <FormField
              label="Address"
              hint="Use HTTPS unless the server is on your private network."
              className="min-w-0"
            >
              <Input
                type="url"
                required
                spellCheck={false}
                value={draft.address}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...draft, address: event.target.value })
                }
              />
            </FormField>
            <FormField label="Path prefix" className="min-w-0">
              <AdminSelect
                ariaLabel="Path prefix"
                placeholder="Choose"
                allowClear={false}
                value={draft.pathPrefix}
                options={OPENAI_COMPATIBLE_PATH_PREFIXES.map((prefix) => ({
                  value: prefix,
                  label: prefix,
                }))}
                disabled={disabled}
                onChange={(value) => onChange({ ...draft, pathPrefix: value })}
              />
            </FormField>
          </div>
          <FormField
            layout="inline"
            label="Send prompts and this provider's key to this address"
          >
            <Checkbox
              checked={
                draft.address !== "" && draft.confirmedAddress === draft.address
              }
              disabled={disabled || draft.address === ""}
              onCheckedChange={(checked) =>
                onChange({
                  ...draft,
                  confirmedAddress: checked === true ? draft.address : null,
                })
              }
            />
          </FormField>
        </div>
      ) : null}

      <section className="space-y-3" aria-label="Models">
        <MonoLabel as="h3" tone="accent">
          Models
        </MonoLabel>
        <p className="text-sm text-text-muted">
          Model IDs change, and Moonshot has no &quot;latest&quot; alias. Enter
          exact IDs with the limits and controls the provider documents, and
          update them when it retires one.
        </p>
        {draft.models.map((model, index) => (
          <ModelFields
            key={model.key}
            draft={model}
            index={index}
            controls={controls}
            removable={draft.models.length > 1}
            disabled={disabled}
            onChange={(changes) => changeModel(model.key, changes)}
            onRemove={() =>
              onChange({
                ...draft,
                models: draft.models.filter((item) => item.key !== model.key),
              })
            }
          />
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={disabled || draft.models.length >= MAX_MODELS}
          onClick={() =>
            onChange({ ...draft, models: [...draft.models, emptyModel()] })
          }
        >
          Add model
        </Button>
      </section>
    </div>
  );
}
