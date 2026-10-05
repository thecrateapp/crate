import { useTranslation } from "react-i18next";
import { Download, ExternalLink, Loader2 } from "@crate/ui/icons";
import { notify } from "@crate/ui/lib/notify";
import { Button } from "@crate/ui/shadcn/button";

import { openExternalUrl } from "@/lib/external-links";
import { cn } from "@/lib/utils";
import { canImportBandcampItem, type BandcampItem } from "./bandcamp-model";

export function BandcampItemActions({
  item,
  busyAction,
  onImport,
  compact = false,
  canImport = canImportBandcampItem(item),
}: {
  item: BandcampItem;
  busyAction: string | null;
  onImport: (item: BandcampItem) => void;
  compact?: boolean;
  canImport?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className={cn("flex gap-2", compact ? "shrink-0" : "flex-wrap")}>
      {canImport ? (
        <Button
          shape="pill"
          aria-label={compact ? t("common.import") : undefined}
          disabled={busyAction !== null}
          onClick={() => onImport(item)}
          className="h-9 px-3 text-xs font-black shadow-none hover:bg-accent-action/90 has-[>svg]:px-3"
        >
          {busyAction === `import:${item.id}` ? (
            <Loader2 className=" size-3.5 animate-spin" />
          ) : (
            <Download className=" size-3.5" />
          )}
          {!compact ? t("common.import") : null}
        </Button>
      ) : null}
      {item.item_url ? (
        <Button
          variant="ghost"
          shape="pill"
          aria-label={compact ? t("actions.bandcamp.open") : undefined}
          onClick={() =>
            void openExternalUrl(item.item_url ?? "").catch(() =>
              notify.error(t("common.toasts.openExternalFailed")),
            )
          }
          className="h-9 border border-border-quiet bg-text-primary/5 px-3 text-xs font-black text-text-primary hover:bg-text-primary/10 hover:text-text-primary has-[>svg]:px-3"
        >
          <ExternalLink className=" size-3.5" />
          {!compact ? t("common.open") : null}
        </Button>
      ) : null}
    </div>
  );
}
