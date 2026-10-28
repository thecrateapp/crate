import { useTranslation } from "react-i18next";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import type { PathDetail } from "./paths-model";

export function PathWarnings({ path }: { path: PathDetail }) {
  const { t } = useTranslation();
  const unavailable = path.tracks.filter(
    (track) => track.playable === false,
  ).length;
  if (!path.is_partial && !unavailable) return null;
  const generated = path.generated_step_count ?? path.tracks.length;
  return (
    <div className="mb-6 space-y-2" role="status">
      {path.is_partial ? (
        <>
          <InfoBadge tone="warning">{t("paths.warnings.partial")}</InfoBadge>
          <p className="text-sm text-text-muted">
            {t(
              generated < path.step_count
                ? "paths.warnings.partialDetail"
                : "paths.warnings.incomplete",
              { generated, requested: path.step_count },
            )}
          </p>
        </>
      ) : null}
      {unavailable ? (
        <p className="text-sm text-text-muted">
          {t("paths.warnings.unavailable", { count: unavailable })}
        </p>
      ) : null}
    </div>
  );
}
