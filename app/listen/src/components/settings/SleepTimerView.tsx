import { FormField } from "@crate/ui/primitives/FormField";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@crate/ui/shadcn/select";
import { Button } from "@crate/ui/shadcn/button";
export function SleepTimerView({
  label,
  options,
  value,
  onChange,
  remaining,
  active = !!remaining,
  cancelLabel,
  onCancel,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  remaining?: string;
  active?: boolean;
  cancelLabel: string;
  onCancel: () => void;
}) {
  return (
    <div className="grid gap-4">
      <FormField label={label}>
        {(field) => (
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger {...field}>
              <SelectValue placeholder={label} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>
      {active ? (
        <div className="flex flex-wrap items-center gap-3">
          {remaining ? (
            <output className="font-mono text-xs tabular-nums text-text-muted">
              {remaining}
            </output>
          ) : null}
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
