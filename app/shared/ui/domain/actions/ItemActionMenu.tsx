import { CRATE_ICON_SIZE, MoreHorizontal } from "@crate/ui/icons";

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
}: ItemActionMenuProps) {
  return (
    <ContextMenu
      header={header}
      items={actions}
      menuRef={menuRef}
      onClose={onClose}
      open={open}
      position={position}
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
      title={title}
      className={className}
    >
      <MoreHorizontal size={CRATE_ICON_SIZE.md} />
    </ActionIconButton>
  );
}
