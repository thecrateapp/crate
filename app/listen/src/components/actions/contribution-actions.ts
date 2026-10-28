import type { TFunction } from "i18next";
import { action, type ItemActionMenuEntry } from "@crate/ui/domain/actions";
import { Download, Trash2 } from "@crate/ui/icons";

export function buildContributionActions(
  input: {
    canExport: boolean;
    onExport: () => void;
    onWithdraw: () => void;
  },
  t: TFunction,
): ItemActionMenuEntry[] {
  return [
    action({
      key: "export-contribution",
      label: t("common.export"),
      icon: Download,
      disabled: !input.canExport,
      onSelect: input.onExport,
    }),
    action({
      key: "withdraw-contribution",
      label: t("library.contributions.withdraw.confirm"),
      icon: Trash2,
      danger: true,
      onSelect: input.onWithdraw,
    }),
  ];
}
