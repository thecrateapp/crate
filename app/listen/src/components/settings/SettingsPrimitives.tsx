import { useSettingsOverlay } from "./settings-panel-activity";
import { useId, type ReactNode } from "react";

import { FormField } from "@crate/ui/primitives/FormField";
import { Slider } from "@crate/ui/primitives/Slider";
import { Switch } from "@crate/ui/primitives/Switch";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crate/ui/shadcn/select";

export function SelectRow<Value extends string>({
  label,
  description,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  value: Value;
  options: readonly { value: Value; label: string; description?: string }[];
  disabled?: boolean;
  onChange: (value: Value) => void;
}) {
  const optionsId = useId();
  const selected = options.find((option) => option.value === value);
  const hint =
    [description, selected?.description].filter(Boolean).join(" ") || undefined;
  const [open, setOpen] = useSettingsOverlay();
  return (
    <FormField label={label} hint={hint}>
      {(field) => (
        <Select
          open={open}
          onOpenChange={setOpen}
          value={value}
          disabled={disabled}
          onValueChange={(next) => onChange(next as Value)}
        >
          <SelectTrigger {...field}>
            <SelectValue>{selected?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent position="popper">
            {options.map((option, index) => (
              <SelectItem
                key={option.value}
                value={option.value}
                textValue={option.label}
                aria-labelledby={`${optionsId}-${index}-label`}
                aria-describedby={
                  option.description ? `${optionsId}-${index}` : undefined
                }
              >
                <span className="grid min-w-0 gap-1 text-left">
                  <span id={`${optionsId}-${index}-label`}>{option.label}</span>
                  {option.description ? (
                    <span
                      id={`${optionsId}-${index}`}
                      className="text-caption text-text-muted"
                    >
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FormField>
  );
}

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
    <InstrumentPanel
      as="section"
      headingLevel={2}
      label={{ children: title, tone: "accent" }}
      description={description}
    >
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
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <FormField label={label} hint={description} layout="inline">
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </FormField>
  );
}
