import type { ReactNode } from "react";
import {
  MediaCover,
  type MediaCoverProps,
} from "@crate/ui/domain/media/MediaCover";
import {
  Calendar,
  CRATE_ICON_SIZE,
  Disc3,
  MoreHorizontal,
} from "@crate/ui/icons";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { UpcomingEventRow } from "@crate/ui/domain/shows/UpcomingEventRow";
import type { ActionMenuSlot } from "./UpcomingShowCardViewTypes";

export { UpcomingEventRow };

export function UpcomingEventArtwork({
  kind,
  src,
  renderImage,
}: {
  kind: "show" | "release";
  src?: string | null;
  renderImage?: MediaCoverProps["renderImage"];
}) {
  return (
    <MediaCover
      src={src}
      alt=""
      renderImage={renderImage}
      fallbackIcon={kind === "show" ? Calendar : Disc3}
      iconSize={CRATE_ICON_SIZE.xl}
      size={88}
      className="rounded-none"
    />
  );
}

export function UpcomingEventMenuAction({
  menu,
  label,
}: {
  menu: ActionMenuSlot;
  label: string;
}) {
  if (!menu.hasActions) return null;
  return (
    <ActionButton
      label={label}
      ref={menu.triggerRef}
      aria-haspopup="menu"
      aria-expanded={menu.open}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={menu.onOpen}
    >
      <MoreHorizontal size={CRATE_ICON_SIZE.md} />
    </ActionButton>
  );
}

export function UpcomingEventRowView({
  artwork,
  details,
  date,
  actions,
  href,
  openLabel,
  onToggle,
  expanded,
}: {
  artwork: ReactNode;
  details: ReactNode;
  date: ReactNode;
  actions: ReactNode;
  href?: string | null;
  openLabel?: string;
  onToggle?: () => void;
  expanded?: boolean;
}) {
  return (
    <UpcomingEventRow
      artwork={artwork}
      details={details}
      date={date}
      actions={actions}
      href={href}
      openLabel={openLabel}
      onToggle={onToggle}
      expanded={expanded}
    />
  );
}
