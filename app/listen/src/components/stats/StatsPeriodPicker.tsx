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
      className="max-w-full overflow-x-auto border-border-quiet bg-surface-canvas/25"
      itemClassName="h-auto px-3.5 py-2 text-xs font-semibold text-text-muted data-[state=inactive]:hover:bg-text-primary/5 data-[state=inactive]:hover:text-text-primary data-[state=active]:text-accent-action-foreground"
    />
  );
}
