import type { TFunction } from "i18next";
import { Download, ExternalLink } from "@crate/ui/icons";

import type { ItemActionMenuEntry } from "@crate/ui/domain/actions";
import { action } from "@/components/actions/shared";

export interface BandcampActionInput {
  canImport: boolean;
  importing?: boolean;
  importDisabled?: boolean;
  itemUrl?: string | null;
  onImport: () => void;
  onOpen: () => void;
}

export function buildBandcampActions(
  input: BandcampActionInput,
  t: TFunction,
): ItemActionMenuEntry[] {
  const entries: ItemActionMenuEntry[] = [];

  if (input.canImport) {
    entries.push(
      action({
        key: "import",
        label: t("common.import"),
        icon: Download,
        disabled: Boolean(input.importing || input.importDisabled),
        onSelect: input.onImport,
      }),
    );
  }

  if (input.itemUrl) {
    entries.push(
      action({
        key: "open",
        label: t("actions.bandcamp.open"),
        icon: ExternalLink,
        onSelect: input.onOpen,
      }),
    );
  }

  return entries;
}
