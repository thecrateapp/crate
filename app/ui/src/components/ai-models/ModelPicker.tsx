import { useEffect, useRef } from "react";

import { AdminSelect, type AdminSelectOption } from "@/components/ui";
import { useApi } from "@/hooks/use-api";
import {
  connectionName,
  eligibleModels,
  isUsableConnection,
  PROVIDER_DEFAULT_REASONING,
  reasoningFromValue,
  reasoningLabel,
  reasoningPresets,
  reasoningValue,
} from "@/lib/ai-models";

import { AI_ROOT } from "./api";
import type {
  Action,
  Connection,
  Model,
  ModelChoice,
  ModelsResponse,
  Snapshot,
} from "./types";

export type { ModelChoice } from "./types";

type ChangeHandler = (next: ModelChoice, model: Model | null) => void;

const CATALOG_ERROR = "Couldn't load this connection's models.";

const NO_PROVIDER =
  "No provider is ready. Add a key or refresh models in Providers below.";

function CatalogSelects({
  connection,
  value,
  onChange,
  onModelResolved,
  feature,
  disabled,
}: {
  connection: Connection | null;
  value: ModelChoice;
  onChange: ChangeHandler;
  onModelResolved?: (model: Model | null) => void;
  feature?: Action;
  disabled?: boolean;
}) {
  const { data, error } = useApi<ModelsResponse>(
    connection
      ? `${AI_ROOT}/connections/${encodeURIComponent(connection.id)}/models`
      : null,
  );
  // useApi errors carry the raw response body; never render them.
  const failed = connection !== null && data === null && error !== null;
  const models =
    connection && data ? eligibleModels(data.models, connection, feature) : [];
  const model = models.find((m) => m.model_id === value.modelId) ?? null;
  const loaded = connection !== null && data !== null;

  // A stored model that this connection can no longer run is not a choice.
  useEffect(() => {
    if (loaded && value.modelId && !model) {
      onChange(
        { ...value, modelId: "", reasoning: PROVIDER_DEFAULT_REASONING },
        null,
      );
    }
  }, [loaded, value.modelId, model]);

  // Callers often pass an inline callback; keep it out of the effect below.
  const onModelResolvedRef = useRef(onModelResolved);
  useEffect(() => {
    onModelResolvedRef.current = onModelResolved;
  });

  // Report the catalog entry of the chosen model once the catalog is loaded,
  // including a model that was preselected rather than picked.
  useEffect(() => {
    if (loaded) onModelResolvedRef.current?.(model);
  }, [loaded, model]);

  const modelOptions: AdminSelectOption[] = models.map((m) => ({
    value: m.model_id,
    label: m.label,
    searchText: m.model_id,
  }));

  const current = reasoningValue(value.reasoning);
  const reasoningOptions: AdminSelectOption[] = model
    ? reasoningPresets(model)
    : [];
  if (model && !reasoningOptions.some((option) => option.value === current)) {
    // Keep a stored choice the presets don't list (for example a custom budget).
    reasoningOptions.push({
      value: current,
      label: reasoningLabel(value.reasoning),
    });
  }

  return (
    <>
      <AdminSelect
        ariaLabel="Model"
        placeholder="Choose a model"
        allowClear={false}
        searchable={modelOptions.length > 8}
        value={model ? model.model_id : ""}
        options={modelOptions}
        disabled={disabled || !connection || failed}
        onChange={(modelId) => {
          if (modelId === value.modelId) return;
          onChange(
            { ...value, modelId, reasoning: PROVIDER_DEFAULT_REASONING },
            models.find((m) => m.model_id === modelId) ?? null,
          );
        }}
      />
      <AdminSelect
        ariaLabel="Reasoning"
        placeholder="Reasoning"
        allowClear={false}
        value={model ? current : ""}
        options={reasoningOptions}
        disabled={disabled || !model}
        onChange={(next) =>
          onChange({ ...value, reasoning: reasoningFromValue(next) }, model)
        }
      />
      {failed ? (
        <p
          role="alert"
          className="basis-full text-sm text-state-warning-text/80"
        >
          {CATALOG_ERROR}
        </p>
      ) : null}
    </>
  );
}

export function ModelPicker({
  snapshot,
  value,
  onChange,
  onModelResolved,
  feature,
  disabled,
}: {
  snapshot: Snapshot;
  value: ModelChoice;
  onChange: ChangeHandler;
  /** Receives the catalog entry of the chosen model whenever it resolves. */
  onModelResolved?: (model: Model | null) => void;
  feature?: Action;
  disabled?: boolean;
}) {
  const connections = snapshot.connections.filter(isUsableConnection);
  const connection =
    connections.find((candidate) => candidate.id === value.connectionId) ??
    null;

  // A connection that is no longer usable cannot stay selected.
  useEffect(() => {
    if (value.connectionId && !connection) {
      onChange(
        {
          connectionId: "",
          modelId: "",
          reasoning: PROVIDER_DEFAULT_REASONING,
        },
        null,
      );
    }
  }, [value.connectionId, connection]);

  if (connections.length === 0) {
    return <p className="text-sm text-state-warning-text/80">{NO_PROVIDER}</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <AdminSelect
        ariaLabel="Connection"
        placeholder="Choose a connection"
        allowClear={false}
        value={connection ? connection.id : ""}
        options={connections.map((candidate) => ({
          value: candidate.id,
          label: connectionName(candidate),
        }))}
        disabled={disabled}
        onChange={(connectionId) => {
          if (connectionId === value.connectionId) return;
          onChange(
            {
              connectionId,
              modelId: "",
              reasoning: PROVIDER_DEFAULT_REASONING,
            },
            null,
          );
        }}
      />
      <CatalogSelects
        key={connection?.id ?? ""}
        connection={connection}
        value={value}
        onChange={onChange}
        onModelResolved={onModelResolved}
        feature={feature}
        disabled={disabled}
      />
    </div>
  );
}
