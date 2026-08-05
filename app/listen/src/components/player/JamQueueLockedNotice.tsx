import { Lock } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

export function JamQueueLockedNotice() {
  const { t } = useTranslation();

  return (
    <div className="mx-3 my-2 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/8 px-3 py-2 text-primary/90">
      <Lock size={14} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[11px] font-semibold">
          {t("player.queue.jamReadonlyTitle")}
        </p>
        <p className="text-[10px] leading-4 text-muted-foreground">
          {t("player.queue.jamReadonlyDescription")}
        </p>
      </div>
    </div>
  );
}
