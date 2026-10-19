import { useId, useState } from "react";

import { Checkbox } from "@crate/ui/primitives/Checkbox";

import {
  presetForGrants,
  presetUnavailableReason,
} from "@/lib/agent-connections";
import type {
  AgentCatalog,
  AgentScope,
  AgentScopePreset,
} from "@/lib/agent-integrations";
import { cn } from "@/lib/utils";

function ScopeCheckbox({
  scope,
  checked,
  disabled,
  onToggle,
}: {
  scope: AgentScope;
  checked: boolean;
  disabled?: boolean;
  onToggle: (scope: string, checked: boolean) => void;
}) {
  const id = useId();
  const isUngrantable = !scope.can_grant;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Checkbox
        id={id}
        title={scope.scope}
        checked={checked}
        disabled={disabled || isUngrantable}
        onCheckedChange={(next) => onToggle(scope.scope, next === true)}
      />
      <label htmlFor={id}>{scope.label}</label>
      {isUngrantable ? (
        <span className="text-xs text-muted-foreground">
          Requires additional permission
        </span>
      ) : null}
    </div>
  );
}

function ScopeColumn({
  title,
  scopes,
  grantSet,
  disabled,
  onToggle,
}: {
  title: string;
  scopes: AgentScope[];
  grantSet: Set<string>;
  disabled?: boolean;
  onToggle: (scope: string, checked: boolean) => void;
}) {
  if (scopes.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </p>
      <div className="space-y-1.5">
        {scopes.map((scope) => (
          <ScopeCheckbox
            key={scope.scope}
            scope={scope}
            checked={grantSet.has(scope.scope)}
            disabled={disabled}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

function PresetCard({
  label,
  description,
  reason,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  description: string;
  reason?: string | null;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const descriptionId = useId();
  const reasonId = useId();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      aria-describedby={reason ? `${descriptionId} ${reasonId}` : descriptionId}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-1 rounded-md border border-border p-3 text-left transition-colors",
        selected ? "border-primary bg-primary/5" : "hover:bg-muted/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      <span className="text-sm font-medium">{label}</span>
      <span id={descriptionId} className="text-sm text-muted-foreground">
        {description}
      </span>
      {reason ? (
        <span id={reasonId} className="text-sm text-destructive">
          {reason}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Lets an admin pick a curated permission preset, or fall back to choosing
 * individual scopes grouped by catalog group and access level.
 */
export function PermissionPicker({
  catalog,
  value,
  onChange,
  disabled,
}: {
  catalog: AgentCatalog;
  value: string[];
  onChange: (grants: string[]) => void;
  disabled?: boolean;
}) {
  const [customChosen, setCustomChosen] = useState(false);
  const matchedPreset = presetForGrants(value, catalog.presets);
  const selected = customChosen ? "custom" : matchedPreset;
  const grantSet = new Set(value);

  function choosePreset(preset: AgentScopePreset) {
    setCustomChosen(false);
    onChange(preset.scopes);
  }

  function toggleScope(scope: string, checked: boolean) {
    onChange(
      checked ? [...value, scope] : value.filter((grant) => grant !== scope),
    );
  }

  return (
    <div className="space-y-4">
      <div
        role="radiogroup"
        aria-label="Access"
        className="grid gap-2 sm:grid-cols-2"
      >
        {catalog.presets.map((preset) => {
          const reason = presetUnavailableReason(preset, catalog.scopes);
          return (
            <PresetCard
              key={preset.id}
              label={preset.label}
              description={preset.description}
              reason={reason}
              selected={selected === preset.id}
              disabled={disabled || reason !== null}
              onSelect={() => choosePreset(preset)}
            />
          );
        })}
        <PresetCard
          label="Custom"
          description="Choose individual permissions."
          selected={selected === "custom"}
          disabled={disabled}
          onSelect={() => setCustomChosen(true)}
        />
      </div>
      {selected === "custom" ? (
        <div className="space-y-4">
          {catalog.scope_groups.map((group) => {
            const scopesInGroup = catalog.scopes.filter(
              (scope) => scope.group === group.id,
            );
            if (scopesInGroup.length === 0) return null;
            const readScopes = scopesInGroup.filter(
              (scope) => scope.access === "read",
            );
            const changeScopes = scopesInGroup.filter(
              (scope) => scope.access === "change",
            );
            return (
              <fieldset key={group.id} className="space-y-2">
                <legend className="text-sm font-medium">{group.label}</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ScopeColumn
                    title="Read"
                    scopes={readScopes}
                    grantSet={grantSet}
                    disabled={disabled}
                    onToggle={toggleScope}
                  />
                  <ScopeColumn
                    title="Change"
                    scopes={changeScopes}
                    grantSet={grantSet}
                    disabled={disabled}
                    onToggle={toggleScope}
                  />
                </div>
              </fieldset>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
