import { useTranslation } from "react-i18next";

import type { StatsWindow } from "./stats-model";
import { STATS_WINDOW_OPTIONS } from "./stats-model";

export function WindowPicker({
  value,
  onChange,
}: {
  value: StatsWindow | null;
  onChange: (value: StatsWindow) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-full border border-border-quiet bg-surface-canvas/25 p-1 backdrop-blur">
      {STATS_WINDOW_OPTIONS.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-black uppercase tracking-[0.12em] transition-[color,background-color,box-shadow] ${
            value === option.value
              ? "bg-accent-action text-accent-action-foreground shadow-accent-action"
              : "text-text-muted hover:bg-text-primary/5 hover:text-text-primary"
          }`}
        >
          {t(option.label)}
        </button>
      ))}
    </div>
  );
}
