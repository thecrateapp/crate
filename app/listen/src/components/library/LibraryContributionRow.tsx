import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { EntityRow } from "@crate/ui/domain/entity/EntityRow";
import type { EntityMenuRenderer } from "@crate/ui/domain/entity";
import { ActionGroup, ActionButton } from "@crate/ui/primitives/ActionGroup";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { CRATE_ICON_SIZE, Download, Trash2 } from "@crate/ui/icons";

export function LibraryContributionRow({
  title,
  artist,
  artwork,
  sourceLabel,
  exportLabel,
  withdrawLabel,
  canExport,
  onExport,
  onWithdraw,
  href,
  renderMenu,
  onOpen,
}: {
  title: string;
  artist: string;
  artwork: ReactNode;
  sourceLabel?: string | null;
  exportLabel: string;
  withdrawLabel: string;
  canExport: boolean;
  onExport: () => void;
  onWithdraw: () => void;
  href?: string;
  renderMenu?: EntityMenuRenderer;
  onOpen?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <EntityRow
      title={title}
      subtitle={artist}
      leading={artwork}
      href={href}
      onOpen={onOpen}
      renderMenu={renderMenu}
      menuLabel={t("actions.menu.more")}
      menuButton={renderMenu ? "always" : "none"}
      aria-label={title}
      meta={sourceLabel ? <InfoBadge>{sourceLabel}</InfoBadge> : undefined}
      trailing={
        <ActionGroup label={title}>
          <ActionButton
            label={`${exportLabel}: ${title}`}
            tooltip={exportLabel}
            disabled={!canExport}
            onClick={onExport}
          >
            <Download size={CRATE_ICON_SIZE.md} />
          </ActionButton>
          <ActionButton
            label={`${withdrawLabel}: ${title}`}
            tooltip={t("common.remove")}
            onClick={onWithdraw}
          >
            <Trash2 size={CRATE_ICON_SIZE.md} />
          </ActionButton>
        </ActionGroup>
      }
    />
  );
}
