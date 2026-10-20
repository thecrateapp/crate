import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { AdminSelect } from "@/components/ui/AdminSelect";
import { cn } from "@/lib/utils";
import { missingFields, type RequiredShowField } from "./show-draft";
import {
  SHOW_FIELD_LABELS,
  SHOW_STATUS_LABELS,
  missingText,
  modelDisplayName,
  outcomeView,
  sourceLabel,
} from "./show-import-presentation";
import {
  isShowSaved,
  type ShowCandidate,
  type ShowOutcome,
} from "./show-import-types";

type TextKey =
  | "artist_name"
  | "date"
  | "local_time"
  | "venue"
  | "city"
  | "country_code"
  | "country"
  | "region"
  | "timezone"
  | "doors_time"
  | "tickets_url"
  | "url"
  | "image_url"
  | "price_range"
  | "address_line1"
  | "postal_code";

interface TextFieldSpec {
  key: TextKey;
  type?: "date" | "time" | "url";
  maxLength?: number;
  placeholder?: string;
  className?: string;
}

const MAIN_FIELDS: TextFieldSpec[] = [
  { key: "artist_name", maxLength: 240, className: "sm:col-span-3" },
  { key: "date", type: "date", className: "sm:col-span-3" },
  { key: "local_time", type: "time", className: "sm:col-span-2" },
  { key: "venue", maxLength: 240, className: "sm:col-span-2" },
  { key: "city", maxLength: 240, className: "sm:col-span-2" },
];

const DETAIL_FIELDS: TextFieldSpec[] = [
  { key: "country_code", maxLength: 2 },
  { key: "country", maxLength: 240 },
  { key: "region", maxLength: 240 },
  { key: "timezone", maxLength: 240, placeholder: "Europe/Madrid" },
  { key: "doors_time", type: "time" },
  { key: "tickets_url", type: "url", maxLength: 2048 },
  { key: "url", type: "url", maxLength: 2048 },
  { key: "image_url", type: "url", maxLength: 2048 },
  { key: "price_range", maxLength: 240 },
  { key: "address_line1", maxLength: 240 },
  { key: "postal_code", maxLength: 240 },
];

const REQUIRED = new Set<string>([
  "artist_name",
  "date",
  "venue",
  "city",
] satisfies RequiredShowField[]);

const STATUS_OPTIONS = Object.entries(SHOW_STATUS_LABELS).map(
  ([value, label]) => ({ value, label }),
);

function parseLineup(value: string): string[] {
  return value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function Field({
  id,
  label,
  hint,
  hintId,
  className,
  children,
}: {
  id?: string;
  label: string;
  hint?: string;
  hintId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      {id ? (
        <label
          htmlFor={id}
          className="block text-xs font-medium text-muted-foreground"
        >
          {label}
        </label>
      ) : (
        <span className="block text-xs font-medium text-muted-foreground">
          {label}
        </span>
      )}
      {children}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function ShowCandidateFields({
  candidate,
  index,
  locked,
  showMissing,
  outcome,
  onChange,
}: {
  candidate: ShowCandidate;
  index: number | null;
  locked: boolean;
  showMissing: boolean;
  outcome?: ShowOutcome;
  onChange: (candidate: ShowCandidate) => void;
}) {
  const baseId = useId();
  const [expanded, setExpanded] = useState(false);
  // While the lineup is being typed, keep the raw text so a trailing comma
  // survives until the next name is typed.
  const [lineupText, setLineupText] = useState<string | null>(null);
  const disabled = locked || isShowSaved(outcome);
  const missing = showMissing ? missingFields(candidate) : [];
  const missingId = `${baseId}-missing`;
  const detailsId = `${baseId}-details`;
  const fieldId = (key: string) => `${baseId}-${key}`;
  const name = (label: string) =>
    index === null ? label : `${label} for show ${index + 1}`;
  const source = sourceLabel(candidate.source_ref);
  const result = outcome ? outcomeView(outcome) : null;

  function textField(spec: TextFieldSpec, hint?: string) {
    const label = SHOW_FIELD_LABELS[spec.key]!;
    const invalid = missing.includes(spec.key as RequiredShowField);
    const hintId = hint ? `${fieldId(spec.key)}-hint` : undefined;
    const describedBy =
      [invalid ? missingId : null, hintId].filter(Boolean).join(" ") ||
      undefined;
    return (
      <Field
        key={spec.key}
        id={fieldId(spec.key)}
        label={label}
        hint={hint}
        hintId={hintId}
        className={spec.className}
      >
        <Input
          id={fieldId(spec.key)}
          aria-label={name(label)}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "h-9",
            REQUIRED.has(spec.key) && "aria-invalid:border-state-danger",
          )}
          type={spec.type ?? "text"}
          value={candidate[spec.key] ?? ""}
          maxLength={spec.maxLength}
          placeholder={spec.placeholder}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...candidate,
              [spec.key]: event.target.value,
              ...(spec.key === "artist_name" ? { artist_uid: null } : {}),
            })
          }
        />
      </Field>
    );
  }

  function coordinateField(key: "latitude" | "longitude") {
    const label = SHOW_FIELD_LABELS[key]!;
    const value = candidate[key];
    return (
      <Field key={key} id={fieldId(key)} label={label}>
        <Input
          id={fieldId(key)}
          aria-label={name(label)}
          className="h-9"
          type="number"
          step="any"
          min={key === "latitude" ? -90 : -180}
          max={key === "latitude" ? 90 : 180}
          value={value ?? ""}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...candidate,
              [key]:
                event.target.value === "" ? null : Number(event.target.value),
            })
          }
        />
      </Field>
    );
  }

  const lineupHintId = `${fieldId("lineup")}-hint`;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-6">
        {MAIN_FIELDS.map((spec) =>
          textField(
            spec,
            spec.key === "local_time" && index === null
              ? "Leave empty if unknown."
              : undefined,
          ),
        )}
      </div>
      {missing.length ? (
        <p id={missingId} className="text-xs text-state-danger-text">
          {missingText(missing)}
        </p>
      ) : null}
      <div className="space-y-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? (
            <ChevronDown aria-hidden="true" />
          ) : (
            <ChevronRight aria-hidden="true" />
          )}
          {expanded ? "Fewer details" : "More details"}
        </Button>
        {expanded ? (
          <div id={detailsId} className="grid gap-3 sm:grid-cols-2">
            {DETAIL_FIELDS.map((spec) => textField(spec))}
            <Field
              id={fieldId("lineup")}
              label={SHOW_FIELD_LABELS.lineup!}
              hint="Separate names with commas."
              hintId={lineupHintId}
            >
              <Input
                id={fieldId("lineup")}
                aria-label={name(SHOW_FIELD_LABELS.lineup!)}
                aria-describedby={lineupHintId}
                className="h-9"
                value={lineupText ?? (candidate.lineup ?? []).join(", ")}
                disabled={disabled}
                onChange={(event) => {
                  setLineupText(event.target.value);
                  onChange({
                    ...candidate,
                    lineup: parseLineup(event.target.value),
                  });
                }}
                onBlur={() => setLineupText(null)}
              />
            </Field>
            <Field label={SHOW_FIELD_LABELS.status!}>
              <AdminSelect
                ariaLabel={name(SHOW_FIELD_LABELS.status!)}
                value={candidate.status ?? "scheduled"}
                options={STATUS_OPTIONS}
                placeholder={SHOW_FIELD_LABELS.status!}
                allowClear={false}
                disabled={disabled}
                triggerClassName="h-9 w-full max-w-none"
                onChange={(status) => onChange({ ...candidate, status })}
              />
            </Field>
            {coordinateField("latitude")}
            {coordinateField("longitude")}
          </div>
        ) : null}
      </div>
      <div className="space-y-1 text-xs text-muted-foreground">
        {candidate.evidence ? (
          <div>
            <p className="font-medium">From the source</p>
            <p
              className="line-clamp-3 whitespace-pre-wrap"
              title={candidate.evidence}
            >
              {candidate.evidence}
            </p>
          </div>
        ) : null}
        {source ? (
          source.href ? (
            <p>
              Source:{" "}
              <a
                href={source.href}
                target="_blank"
                rel="noreferrer"
                className="text-foreground underline underline-offset-2"
              >
                {source.text}
              </a>
            </p>
          ) : (
            <p>Source: {source.text}</p>
          )
        ) : null}
        {candidate.extractor_model ? (
          <p>Read by {modelDisplayName(candidate.extractor_model)}</p>
        ) : null}
        {outcome ? (
          <div className="flex flex-wrap items-center gap-2">
            {/* In a list the row header already shows the outcome badge. */}
            {result && index === null ? (
              <StatusBadge tone={result.tone}>{result.label}</StatusBadge>
            ) : null}
            {outcome.show_id ? (
              <a
                href={`/shows?show_id=${outcome.show_id}`}
                target="_blank"
                rel="noreferrer"
                className="text-foreground underline underline-offset-2"
              >
                Open show
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
