import type { ReactNode } from "react";
import { Link } from "react-router";
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
import type { ActionMenuSlot } from "./UpcomingShowCardViewTypes";

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
      className="size-[88px] shrink-0 rounded-none"
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
}: {
  artwork: ReactNode;
  details: ReactNode;
  date: ReactNode;
  actions: ReactNode;
  href?: string | null;
  openLabel?: string;
  onToggle?: () => void;
}) {
  const content = (
    <>
      {artwork}
      <span className="block min-w-0 flex-1 px-3 py-2.5">{details}</span>
      {date}
    </>
  );
  const identityClass =
    "flex min-w-0 flex-1 items-center text-left crate-focus-inset";
  return (
    <div
      data-slot="upcoming-event-row"
      className="flex min-h-[88px] min-w-0 items-center bg-surface-object"
    >
      {onToggle ? (
        <button
          type="button"
          aria-expanded={false}
          onClick={onToggle}
          className={identityClass}
        >
          {content}
        </button>
      ) : href ? (
        <Link to={href} aria-label={openLabel} className={identityClass}>
          {content}
        </Link>
      ) : (
        <div className={identityClass}>{content}</div>
      )}
      <div className="shrink-0">{actions}</div>
    </div>
  );
}
