import type { ReactNode } from "react";
import {
  EntityCard,
  EntityRow,
  type EntityActionMenu,
} from "@crate/ui/domain/entity";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";

export interface BandcampItemViewProps {
  variant: "tile" | "row";
  title: string;
  artist?: string | null;
  artwork: ReactNode;
  actions?: ReactNode;
  actionMenu?: EntityActionMenu;
  menuLabel: string;
  onOpen?: () => void;
  importedLabel?: string;
}

/** Album tiles reuse the actual EntityCard; collection rows retain56px artwork. */
export function BandcampItemView({
  variant,
  title,
  artist,
  artwork,
  actions,
  actionMenu,
  menuLabel,
  onOpen,
  importedLabel,
}: BandcampItemViewProps) {
  const meta = importedLabel ? (
    <InfoBadge tone="success">{importedLabel}</InfoBadge>
  ) : undefined;
  if (variant === "tile") {
    return (
      <EntityCard
        layout="grid"
        title={title}
        subtitle={artist}
        artwork={artwork}
        meta={meta}
        onOpen={onOpen}
        actionMenu={actionMenu}
        menuLabel={menuLabel}
      />
    );
  }
  return (
    <EntityRow
      title={title}
      subtitle={artist}
      leading={artwork}
      meta={meta}
      trailing={actions}
      actionMenu={actionMenu}
      menuLabel={menuLabel}
      menuButton="always"
      truncate={false}
    />
  );
}
