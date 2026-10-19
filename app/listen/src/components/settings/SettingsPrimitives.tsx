import { useId, type ReactNode } from "react";

import { FormField } from "@crate/ui/primitives/FormField";
import { Slider } from "@crate/ui/primitives/Slider";
import { Switch } from "@crate/ui/primitives/Switch";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <InstrumentPanel as="section" headingLevel={2} label={{ children: title }}>
      {description ? (
        <p className="mb-5 text-sm text-text-muted">{description}</p>
      ) : null}
      <div className="space-y-5">{children}</div>
    </InstrumentPanel>
  );
}

export function RangeRow({
  label,
  description,
  value,
  min,
  max,
  step,
  displayValue,
  disabled = false,
  onChange,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <FormField
      label={
        <span className="flex items-center justify-between gap-4">
          <span>{label}</span>
          <span
            aria-hidden="true"
            data-slot="form-field-value"
            className="font-mono font-normal text-label normal-case"
          >
            {displayValue ?? value}
          </span>
        </span>
      }
      hint={description}
    >
      <Slider
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </FormField>
  );
}

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const descriptionId = useId();

  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm font-medium text-text-primary">{label}</div>
        {description ? (
          <p
            id={descriptionId}
            className="mt-1 text-xs leading-5 text-text-muted"
          >
            {description}
          </p>
        ) : null}
      </div>
      <Switch
        aria-label={label}
        aria-describedby={description ? descriptionId : undefined}
        checked={checked}
        onCheckedChange={onChange}
      />
    </div>
  );
}
