import { useId, useRef, useState, type KeyboardEvent } from "react";

import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { Button } from "@crate/ui/shadcn/button";

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
      <p className="text-xs font-normal tracking-wide text-muted-foreground uppercase font-mono">
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
  focusable,
  buttonRef,
  onSelect,
  onKeyDown,
}: {
  label: string;
  description: string;
  reason?: string | null;
  selected: boolean;
  disabled?: boolean;
  focusable: boolean;
  buttonRef: (node: HTMLButtonElement | null) => void;
  onSelect: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const descriptionId = useId();
  const reasonId = useId();
  return (
    <button
      ref={buttonRef}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      aria-describedby={reason ? `${descriptionId} ${reasonId}` : descriptionId}
      disabled={disabled}
      tabIndex={focusable ? 0 : -1}
      onClick={onSelect}
      onKeyDown={onKeyDown}
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
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // The custom set in place before a preset was picked, restored when Custom
  // is chosen again so trying a preset does not lose it.
  const lastCustom = useRef<string[] | null>(null);
  const matchedPreset = presetForGrants(value, catalog.presets);
  const selected = customChosen ? "custom" : matchedPreset;
  const grantSet = new Set(value);
  const cards = [
    ...catalog.presets.map((preset) => {
      const reason = presetUnavailableReason(preset, catalog.scopes);
      return {
        id: preset.id,
        label: preset.label,
        description: preset.description,
        reason,
        disabled: Boolean(disabled) || reason !== null,
        select: () => choosePreset(preset),
      };
    }),
    {
      id: "custom",
      label: "Custom",
      description: "Choose individual permissions.",
      reason: null,
      disabled: Boolean(disabled),
      select: () => chooseCustom(),
    },
  ];
  // Roving tabindex, as in SegmentedControl: the group is one Tab stop, on
  // the checked card when it is enabled, otherwise on the first enabled one.
  const selectedIndex = cards.findIndex((card) => card.id === selected);
  const focusableIndex =
    selectedIndex >= 0 && !cards[selectedIndex]?.disabled
      ? selectedIndex
      : cards.findIndex((card) => !card.disabled);

  // Grants the catalog does not describe (removed since they were stored).
  // They would be sent back on save and refused, so Custom lists them with a
  // way to remove them.
  const knownScopes = new Set(catalog.scopes.map((scope) => scope.scope));
  const unknownGrants = value.filter((grant) => !knownScopes.has(grant));

  function choosePreset(preset: AgentScopePreset) {
    if (selected === "custom") lastCustom.current = [...value];
    setCustomChosen(false);
    onChange(preset.scopes);
  }

  function chooseCustom() {
    setCustomChosen(true);
    const previous = lastCustom.current;
    if (selected !== "custom" && previous) onChange(previous);
  }

  function toggleScope(scope: string, checked: boolean) {
    onChange(
      checked ? [...value, scope] : value.filter((grant) => grant !== scope),
    );
  }

  function findEnabled(start: number, step: 1 | -1): number {
    const count = cards.length;
    for (let offset = 1; offset <= count; offset += 1) {
      const index = (((start + step * offset) % count) + count) % count;
      if (!cards[index]?.disabled) return index;
    }
    return -1;
  }

  function moveTo(index: number) {
    const card = cards[index];
    if (!card) return;
    cardRefs.current[index]?.focus();
    if (card.id !== selected) card.select();
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let next = -1;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = findEnabled(index, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = findEnabled(index, -1);
        break;
      case "Home":
        next = cards.findIndex((card) => !card.disabled);
        break;
      case "End":
        next = findEnabled(0, -1);
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next >= 0) moveTo(next);
  }

  return (
    <div className="space-y-4">
      <div
        role="radiogroup"
        aria-label="Access"
        className="grid gap-2 sm:grid-cols-2"
      >
        {cards.map((card, index) => (
          <PresetCard
            key={card.id}
            label={card.label}
            description={card.description}
            reason={card.reason}
            selected={selected === card.id}
            disabled={card.disabled}
            focusable={index === focusableIndex}
            buttonRef={(node) => {
              cardRefs.current[index] = node;
            }}
            onSelect={card.select}
            onKeyDown={(event) => handleKeyDown(event, index)}
          />
        ))}
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
          {unknownGrants.length > 0 ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Other</legend>
              <ul className="space-y-1.5">
                {unknownGrants.map((grant) => (
                  <li
                    key={grant}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <span title={grant}>Unknown permission</span>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      title={grant}
                      aria-label="Remove unknown permission"
                      disabled={disabled}
                      onClick={() =>
                        onChange(value.filter((other) => other !== grant))
                      }
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
