import { useTranslation } from "react-i18next";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import type { RadioMode } from "./radio-types";
export function RadioSessionStatus({
  activeSession,
  activeMode,
  seedLabel,
}: {
  activeSession: string | null;
  activeMode: RadioMode | null;
  seedLabel: string;
}) {
  const { t } = useTranslation();
  if (!activeSession) return null;
  return (
    <section
      aria-label={t("common.playing")}
      className="grid gap-2 border-y border-border-quiet py-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <StatusDot pulse label={t("common.playing")} />
        <MonoLabel as="span">
          {activeMode === "discovery" ? t("radio.discovery") : seedLabel}
        </MonoLabel>
      </div>
      {activeMode !== "discovery" && (
        <p className="text-caption text-text-muted">
          {t("radio.feedback.likePrefix")} {t("radio.feedback.dislikeSuffix")}
        </p>
      )}
    </section>
  );
}
