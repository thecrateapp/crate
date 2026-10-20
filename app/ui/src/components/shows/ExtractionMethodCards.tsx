import { useId } from "react";
import { RadioGroup, RadioGroupItem } from "@crate/ui/primitives/RadioGroup";
import { Button } from "@crate/ui/shadcn/button";
import { StatusBadge } from "@/components/admin/StatusBadge";
import {
  aiSendNote,
  readinessView,
  type MethodOption,
  type ReadinessState,
} from "./show-import-presentation";
import type { ExtractionMethod } from "./show-import-types";

function MethodCard({
  option,
  checked,
  readiness,
  ocrReason,
  onRecheck,
}: {
  option: MethodOption;
  checked: boolean;
  readiness: ReadinessState;
  ocrReason?: string | null;
  onRecheck: () => void;
}) {
  const id = useId();
  const itemId = `${id}-item`;
  const descriptionId = `${id}-description`;
  const isOcr = option.method === "ocr";
  const view = isOcr ? readinessView(readiness, ocrReason) : null;
  const canRecheck =
    isOcr && (readiness === "unchecked" || readiness === "failed");
  return (
    <div
      data-state={checked ? "checked" : "unchecked"}
      className="flex flex-col gap-2 rounded-md border border-border p-3 data-[state=checked]:border-accent-action"
    >
      <div className="flex items-start gap-2">
        <RadioGroupItem
          id={itemId}
          value={option.method}
          disabled={option.disabledReason !== null}
          aria-describedby={descriptionId}
          className="mt-0.5"
        />
        <label htmlFor={itemId} className="text-sm font-medium leading-5">
          {option.title}
        </label>
      </div>
      <p id={descriptionId} className="text-xs text-muted-foreground">
        {option.description}
      </p>
      <StatusBadge tone={option.billable ? "info" : "success"}>
        <span title={option.model ?? undefined}>{option.cost}</span>
      </StatusBadge>
      {option.disabledReason ? (
        <div className="space-y-1 text-xs">
          <p className="text-state-warning-text">{option.disabledReason}</p>
          {option.manageInAiModels ? (
            <a
              href="/ai"
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline underline-offset-2"
            >
              Manage in AI models
            </a>
          ) : null}
        </div>
      ) : null}
      {view ? (
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={view.tone}>{view.label}</StatusBadge>
          {canRecheck ? (
            <Button type="button" variant="ghost" size="xs" onClick={onRecheck}>
              Check again
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ExtractionMethodCards({
  options,
  value,
  readiness,
  ocrReason,
  disabled = false,
  onChange,
  onRecheck,
}: {
  options: MethodOption[];
  value: ExtractionMethod | null;
  readiness: ReadinessState;
  ocrReason?: string | null;
  disabled?: boolean;
  onChange: (method: ExtractionMethod) => void;
  onRecheck: () => void;
}) {
  const selected = options.find((option) => option.method === value) ?? null;
  const note = selected ? aiSendNote(selected) : null;
  return (
    <div className="space-y-2">
      <RadioGroup
        aria-label="How to read the source"
        value={value}
        disabled={disabled}
        onValueChange={(next) => onChange(next as ExtractionMethod)}
        className="grid gap-2 sm:grid-cols-3"
      >
        {options.map((option) => (
          <MethodCard
            key={option.method}
            option={option}
            checked={option.method === value}
            readiness={readiness}
            ocrReason={ocrReason}
            onRecheck={onRecheck}
          />
        ))}
      </RadioGroup>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}
