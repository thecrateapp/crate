import { TooltipHint } from "@crate/ui/shadcn/tooltip";
import type { ComponentType, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE } from "@crate/ui/icons";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import type { EqSource } from "../../lib/equalizer-types";

/** The single, consistent information surface under every EQ curve. */
export function EqualizerInformationBand({
  children,
  icon: Icon,
  source,
  current = false,
  title,
  label,
}: {
  children: ReactNode;
  icon?: ComponentType<{ size: number; "aria-hidden"?: boolean }>;
  source?: EqSource;
  current?: boolean;
  title?: string;
  label?: string;
}) {
  const { t } = useTranslation();
  return (
    <TooltipHint content={title}>
      <MonoLabel
        as="div"
        tone="accent"
        role="group"
        aria-label={t("player.equalizer.trackCurves")}
        data-slot="eq-curve-readout"
        data-source={source}
        aria-current={current ? "true" : undefined}
        className="flex min-w-0 items-start gap-2 rounded-md border border-accent-action/30 bg-accent-action/10 px-2.5 py-1.5"
      >
        {Icon ? (
          <span className="flex h-lh shrink-0 items-center">
            <Icon size={CRATE_ICON_SIZE.nano} aria-hidden />
          </span>
        ) : null}
        <span className="min-w-0 wrap-anywhere">
          {label ? `${label}: ` : null}
          {children}
        </span>
      </MonoLabel>
    </TooltipHint>
  );
}
