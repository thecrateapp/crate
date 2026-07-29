import {
  ContextMenu as SharedContextMenu,
  ItemActionMenu as SharedItemActionMenu,
  type ContextMenuProps,
  type ItemActionMenuProps,
  type ContextMenuMediaImageProps,
} from "@crate/ui/domain/actions";

import { CrateImage } from "@/components/artwork/CrateImage";

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
    <SharedItemActionMenu {...props} renderMediaImage={renderMediaImage} />
  );
}

export function ContextMenu(props: ContextMenuProps) {
  return <SharedContextMenu {...props} renderMediaImage={renderMediaImage} />;
}
