import { useId } from "react";
import { RadioGroup, RadioGroupItem } from "@crate/ui/primitives/RadioGroup";
import { Button } from "@crate/ui/shadcn/button";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { useAuth } from "@/contexts/AuthContext";
import {
  aiSendNote,
  readinessView,
  type MethodOption,
  type ReadinessState,
  type SentAlong,
} from "./show-import-presentation";
import type { ExtractionMethod } from "./show-import-types";

// Both read the image with the worker's OCR engine first.
const OCR_METHODS = new Set<ExtractionMethod>(["ocr", "ocr_text_llm"]);

function MethodCard({
  option,
  checked,
  readiness,
  canManageModels,
  onRecheck,
}: {
  option: MethodOption;
  checked: boolean;
  readiness: ReadinessState;
  canManageModels: boolean;
  onRecheck: () => void;
}) {
  const id = useId();
  const itemId = `${id}-item`;
  const descriptionId = `${id}-description`;
  const costId = `${id}-cost`;
  const reasonId = `${id}-reason`;
  const isOcr = OCR_METHODS.has(option.method);
  const view = isOcr ? readinessView(readiness) : null;
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
          aria-describedby={[
            descriptionId,
            costId,
            option.disabledReason ? reasonId : null,
          ]
            .filter(Boolean)
            .join(" ")}
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
        <span id={costId} title={option.model ?? undefined}>
          {option.cost}
        </span>
      </StatusBadge>
      {option.disabledReason ? (
        <div className="space-y-1 text-xs">
          <p id={reasonId} className="text-state-warning-text">
            {option.disabledReason}
          </p>
          {/* AI models is gated by ai.config.read; without it the link
              only leads to «Permission required». */}
          {option.manageInAiModels ? (
            canManageModels ? (
              <a
                href="/ai"
                target="_blank"
                rel="noreferrer"
                className="text-foreground underline underline-offset-2"
              >
                Manage in AI models
              </a>
            ) : (
              <p className="text-muted-foreground">
                An admin can turn this on in AI models.
              </p>
            )
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
  along,
  disabled = false,
  onChange,
  onRecheck,
}: {
  options: MethodOption[];
  value: ExtractionMethod | null;
  readiness: ReadinessState;
  /** The text sources an image method sends along with the image. */
  along: SentAlong;
  disabled?: boolean;
  onChange: (method: ExtractionMethod) => void;
  onRecheck: () => void;
}) {
  const { hasCapability } = useAuth();
  const canManageModels = hasCapability("ai.config.read");
  const selected = options.find((option) => option.method === value) ?? null;
  const note = selected ? aiSendNote(selected, along) : null;
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
            canManageModels={canManageModels}
            onRecheck={onRecheck}
          />
        ))}
      </RadioGroup>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}
