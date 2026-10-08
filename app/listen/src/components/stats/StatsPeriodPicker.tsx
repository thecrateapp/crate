import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";

import type { StatsSelection } from "@/components/stats/stats-model";
import type { StatsSelectionOption } from "@/pages/stats-page-model";

export function StatsPeriodPicker({
  options,
  value,
  onChange,
}: {
  options: StatsSelectionOption[];
  value: StatsSelection | null;
  onChange: (value: StatsSelection) => void;
}) {
  const { t } = useTranslation();
  const items = useMemo(
    () =>
      options.map((option) => ({
        value: option.value,
        label: /^\d{4}$/.test(option.label) ? option.label : t(option.label),
      })),
    [options, t],
  );

  return (
    <SegmentedControl<string>
      items={items}
      value={value ?? ""}
      onValueChange={(next) => {
        const option = options.find((candidate) => candidate.value === next);
        if (option) onChange(option.value);
      }}
      as="radio"
      label={t("stats.window.label")}
      fullWidth
      className="border-border-quiet bg-surface-canvas/25 lg:inline-flex lg:w-auto"
      itemClassName="font-semibold data-[state=inactive]:text-text-muted data-[state=inactive]:hover:bg-text-primary/5 data-[state=inactive]:hover:text-text-primary"
    />
  );
}
