import { useTranslation } from "react-i18next";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@crate/ui/shadcn/select";
import type { CollectionSortOption } from "./library-collection-model";

export function CollectionSortDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: CollectionSortOption<T>[];
  onChange: (value: T) => void;
}) {
  const { t } = useTranslation();
  const selected =
    options.find((option) => option.value === value) ?? options[0];
  if (!selected) return null;
  const selectedLabel = t(selected.labelKey);

  return (
    <Select
      value={selected.value}
      onValueChange={(next) => onChange(next as T)}
    >
      <SelectTrigger
        aria-label={t("library.sort.selectedAria", {
          label,
          value: selectedLabel,
        })}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="end" aria-label={label}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {t(option.labelKey)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
