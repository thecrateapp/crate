import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";

import type { StatsWindow } from "./stats-model";
import { STATS_WINDOW_OPTIONS } from "./stats-model";

const WINDOW_PICKER_CLASS_NAME =
  "max-w-full overflow-x-auto border-border-quiet bg-surface-canvas/25 backdrop-blur";

const WINDOW_PICKER_ITEM_CLASS_NAME =
  "h-auto px-3.5 py-2 text-xs font-black uppercase tracking-[0.12em] text-text-muted data-[state=inactive]:hover:bg-text-primary/5 data-[state=inactive]:hover:text-text-primary data-[state=active]:text-accent-action-foreground data-[state=active]:shadow-accent-action";

export function WindowPicker({
  value,
  onChange,
}: {
  value: StatsWindow | null;
  onChange: (value: StatsWindow) => void;
}) {
  const { t } = useTranslation();
  const items = useMemo(
    () =>
      STATS_WINDOW_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.label),
      })),
    [t],
  );

  return (
    <SegmentedControl<string>
      items={items}
      value={value ?? ""}
      onValueChange={(next) => {
        const option = STATS_WINDOW_OPTIONS.find(
          (candidate) => candidate.value === next,
        );
        if (option) onChange(option.value);
      }}
      as="radio"
      label={t("stats.window.label")}
      className={WINDOW_PICKER_CLASS_NAME}
      itemClassName={WINDOW_PICKER_ITEM_CLASS_NAME}
    />
  );
}
