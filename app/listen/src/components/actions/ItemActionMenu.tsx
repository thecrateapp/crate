import {
  ContextMenu as SharedContextMenu,
  type ContextMenuProps,
  type ItemActionMenuProps,
  type ContextMenuMediaImageProps,
} from "@crate/ui/domain/actions";

import { CrateImage } from "@/components/artwork/CrateImage";
import { cn } from "@/lib/utils";

export {
  ItemActionMenuButton,
  MobileActionSheet,
  useItemActionMenu,
} from "@crate/ui/domain/actions";
export type {
  ContextMenuEntry,
  ContextMenuHeader,
  ItemActionMenuEntry,
  ItemActionMenuProps,
  UseItemActionMenuOptions,
  UseItemActionMenuReturn,
} from "@crate/ui/domain/actions";

function renderMediaImage({ src, ...props }: ContextMenuMediaImageProps) {
  return <CrateImage {...props} source={src} />;
}

export function ItemActionMenu(props: ItemActionMenuProps) {
  return (
    <ContextMenu
      header={props.header}
      items={props.actions}
      menuRef={props.menuRef}
      onClose={props.onClose}
      open={props.open}
      position={props.position}
    />
  );
}

export function ContextMenu(props: ContextMenuProps) {
  return (
    <SharedContextMenu
      {...props}
      className={cn("rounded-[12px]", props.className)}
      renderMediaImage={renderMediaImage}
    />
  );
}
