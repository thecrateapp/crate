import type { ReactNode } from "react";

import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Input } from "@crate/ui/shadcn/input";

export interface SmartMixNightWindow {
  start: string;
  end: string;
  timezone: string;
}

export interface SmartMixBackfillSettingsValue {
  batchSize: number;
  maxAttempts: number;
  nightWindow: SmartMixNightWindow;
  nightConcurrency: number;
  dayConcurrency: number;
}

export interface SmartMixBackfillLimit {
  window: "night" | "day";
  limit: number;
}

const CONCURRENCY = { min: 1, max: 32 };
const BATCH_SIZE = { min: 1, max: 100 };
const ATTEMPTS = { min: 1, max: 10 };
const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

type Field = keyof SmartMixBackfillSettingsValue | "start" | "end" | "timezone";

const NO_INVALID_FIELDS: ReadonlySet<Field> = new Set();

function withinRange(
  value: number,
  { min, max }: { min: number; max: number },
) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function isTimezone(value: string) {
  if (!value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Fields of the draft that the API would reject. */
export function invalidBackfillFields(
  draft: SmartMixBackfillSettingsValue,
): Set<Field> {
  const invalid = new Set<Field>();
  const { start, end, timezone } = draft.nightWindow;
  if (!HHMM.test(start)) invalid.add("start");
  if (!HHMM.test(end) || start === end) invalid.add("end");
  if (!isTimezone(timezone)) invalid.add("timezone");
  if (!withinRange(draft.nightConcurrency, CONCURRENCY)) {
    invalid.add("nightConcurrency");
  }
  if (!withinRange(draft.dayConcurrency, CONCURRENCY)) {
    invalid.add("dayConcurrency");
  }
  if (!withinRange(draft.batchSize, BATCH_SIZE)) invalid.add("batchSize");
  if (!withinRange(draft.maxAttempts, ATTEMPTS)) invalid.add("maxAttempts");
  return invalid;
}

export function backfillWindowLabel(limit: SmartMixBackfillLimit) {
  return `${limit.window === "night" ? "Night window" : "Day"} · ${
    limit.limit
  } in flight`;
}

function numberValue(value: number): number | "" {
  return Number.isFinite(value) ? value : "";
}

interface SmartMixBackfillSettingsProps {
  saved: SmartMixBackfillSettingsValue;
  draft: SmartMixBackfillSettingsValue;
  showErrors: boolean;
  disabled: boolean;
  action?: ReactNode;
  onChange: (draft: SmartMixBackfillSettingsValue) => void;
}

/**
 * Night window and batch settings of the Smart Mix backfill. Start and Resume
 * send them; a running backfill takes them from Apply settings, on its next
 * batch.
 */
export function SmartMixBackfillSettings({
  saved,
  draft,
  showErrors,
  disabled,
  action,
  onChange,
}: SmartMixBackfillSettingsProps) {
  const { nightWindow } = saved;
  const invalid = showErrors ? invalidBackfillFields(draft) : NO_INVALID_FIELDS;
  const error = (field: Field, message: string) =>
    invalid.has(field) ? message : undefined;
  const setWindow = (changes: Partial<SmartMixNightWindow>) =>
    onChange({ ...draft, nightWindow: { ...draft.nightWindow, ...changes } });

  return (
    <section
      aria-labelledby="smart-mix-backfill-settings"
      className="space-y-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <MonoLabel as="h3" id="smart-mix-backfill-settings">
            Backfill settings
          </MonoLabel>
          <p className="text-xs text-text-muted">
            {nightWindow.start} to {nightWindow.end} {nightWindow.timezone}:{" "}
            {saved.nightConcurrency} analyses in flight. Rest of the day:{" "}
            {saved.dayConcurrency}.
          </p>
        </div>
        {action}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-4">
        <FormField label="Night start" error={error("start", "Use HH:MM")}>
          <Input
            type="time"
            disabled={disabled}
            value={draft.nightWindow.start}
            onChange={(event) => setWindow({ start: event.target.value })}
          />
        </FormField>
        <FormField
          label="Night end"
          error={error("end", "Use HH:MM, not the start time")}
        >
          <Input
            type="time"
            disabled={disabled}
            value={draft.nightWindow.end}
            onChange={(event) => setWindow({ end: event.target.value })}
          />
        </FormField>
        <FormField
          label="Timezone"
          error={error("timezone", "Use an IANA name such as Europe/Madrid")}
        >
          <Input
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
            disabled={disabled}
            value={draft.nightWindow.timezone}
            onChange={(event) => setWindow({ timezone: event.target.value })}
          />
        </FormField>
        <FormField
          label="Night in flight"
          error={error("nightConcurrency", "From 1 to 32")}
        >
          <Input
            type="number"
            min={CONCURRENCY.min}
            max={CONCURRENCY.max}
            disabled={disabled}
            value={numberValue(draft.nightConcurrency)}
            onChange={(event) =>
              onChange({
                ...draft,
                nightConcurrency: event.target.valueAsNumber,
              })
            }
          />
        </FormField>
        <FormField
          label="Day in flight"
          error={error("dayConcurrency", "From 1 to 32")}
        >
          <Input
            type="number"
            min={CONCURRENCY.min}
            max={CONCURRENCY.max}
            disabled={disabled}
            value={numberValue(draft.dayConcurrency)}
            onChange={(event) =>
              onChange({ ...draft, dayConcurrency: event.target.valueAsNumber })
            }
          />
        </FormField>
        <FormField
          label="Batch size"
          error={error("batchSize", "From 1 to 100")}
        >
          <Input
            type="number"
            min={BATCH_SIZE.min}
            max={BATCH_SIZE.max}
            disabled={disabled}
            value={numberValue(draft.batchSize)}
            onChange={(event) =>
              onChange({ ...draft, batchSize: event.target.valueAsNumber })
            }
          />
        </FormField>
        <FormField
          label="Attempts"
          error={error("maxAttempts", "From 1 to 10")}
        >
          <Input
            type="number"
            min={ATTEMPTS.min}
            max={ATTEMPTS.max}
            disabled={disabled}
            value={numberValue(draft.maxAttempts)}
            onChange={(event) =>
              onChange({ ...draft, maxAttempts: event.target.valueAsNumber })
            }
          />
        </FormField>
      </div>
    </section>
  );
}
