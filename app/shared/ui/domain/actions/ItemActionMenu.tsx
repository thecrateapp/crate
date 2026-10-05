import { CRATE_ICON_SIZE, MoreHorizontal } from "@crate/ui/icons";

import { cn } from "@crate/ui/lib/cn";
import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";

import { ContextMenu } from "./ContextMenu";
import {
  type ItemActionMenuProps,
  type ItemActionMenuButtonProps,
  type ItemActionMenuEntry,
  type UseItemActionMenuOptions,
  type UseItemActionMenuReturn,
} from "./useItemActionMenu";

export type {
  ItemActionMenuEntry,
  ItemActionMenuProps,
  ItemActionMenuButtonProps,
  UseItemActionMenuOptions,
  UseItemActionMenuReturn,
};
export { useItemActionMenu } from "./useItemActionMenu";

export function ItemActionMenu({
  actions,
  header,
  open,
  position,
  menuRef,
  onClose,
  renderMediaImage,
  surfaceClassName,
  sheetLabel,
}: ItemActionMenuProps) {
  return (
    <ContextMenu
      header={header}
      items={actions}
      menuRef={menuRef}
      onClose={onClose}
      open={open}
      position={position}
      renderMediaImage={renderMediaImage}
      surfaceClassName={surfaceClassName}
      sheetLabel={sheetLabel}
    />
  );
}

export function ItemActionMenuButton({
  onClick,
  buttonRef,
  className,
  title = "More actions",
  onContextMenu,
  hasActions = true,
  expanded,
}: ItemActionMenuButtonProps) {
  if (!hasActions) return null;
  return (
    <ActionIconButton
      ref={buttonRef}
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      aria-label={title}
      aria-haspopup="menu"
      aria-expanded={expanded}
      title={title}
      className={cn(
        "focus-visible:shadow-focus focus-visible:outline-none",
        className,
      )}
    >
      <MoreHorizontal size={CRATE_ICON_SIZE.md} />
    </ActionIconButton>
  );
}
