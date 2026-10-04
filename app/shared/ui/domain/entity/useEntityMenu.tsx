import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";

import { ItemActionMenu } from "@crate/ui/domain/actions/ItemActionMenu";
import type { ContextMenuHeader } from "@crate/ui/domain/actions/types";
import {
  useItemActionMenu,
  type ItemActionMenuEntry,
  type UseItemActionMenuReturn,
} from "@crate/ui/domain/actions/useItemActionMenu";
import {
  useItemActionTarget,
  type ItemActionTargetProps,
} from "@crate/ui/domain/actions/useItemActionTarget";

import type { EntityActionMenu, EntityMenuRenderer } from "./types";

const NO_ACTIONS: ItemActionMenuEntry[] = [];

export interface UseEntityMenuOptions {
  actionMenu?: EntityActionMenu;
  renderMenu?: EntityMenuRenderer;
  disabled?: boolean;
  disableItemActionTarget?: boolean;
  getFallbackHeader: () => ContextMenuHeader;
}

export interface UseEntityMenuReturn {
  controller: UseItemActionMenuReturn;
  targetProps: ItemActionTargetProps;
  menu: ReactNode;
}

function EntityActionMenuContent({
  actionMenu,
  controller,
  getActions,
  getFallbackHeader,
}: {
  actionMenu: EntityActionMenu;
  controller: UseItemActionMenuReturn;
  getActions: () => ItemActionMenuEntry[];
  getFallbackHeader: () => ContextMenuHeader;
}) {
  const actions = useMemo(() => getActions(), [getActions]);
  const header = actionMenu.header ?? getFallbackHeader();
  return (
    <ItemActionMenu
      actions={actions}
      header={header}
      open={controller.open}
      position={controller.position}
      menuRef={controller.menuRef}
      onClose={controller.close}
      renderMediaImage={actionMenu.renderMediaImage}
      surfaceClassName={actionMenu.surfaceClassName}
      sheetLabel={actionMenu.sheetLabel}
    />
  );
}

export function useEntityMenu({
  actionMenu,
  renderMenu,
  disabled = false,
  disableItemActionTarget = false,
  getFallbackHeader,
}: UseEntityMenuOptions): UseEntityMenuReturn {
  const enabled = !disabled && Boolean(renderMenu || actionMenu?.getActions);
  const onOpenChangeRef = useRef(actionMenu?.onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = actionMenu?.onOpenChange;
  });
  const handleOpenChange = useCallback((open: boolean) => {
    onOpenChangeRef.current?.(open);
  }, []);
  const controller = useItemActionMenu(NO_ACTIONS, {
    hasActions: enabled,
    disabled: !enabled || Boolean(actionMenu?.disabled),
    placement: actionMenu?.placement,
    onOpenChange: handleOpenChange,
  });
  const targetProps = useItemActionTarget(controller, {
    disabled: disableItemActionTarget || Boolean(actionMenu?.disabled),
  });

  let menu: ReactNode = null;
  if (controller.open) {
    if (renderMenu) {
      menu = renderMenu(controller);
    } else if (actionMenu?.getActions) {
      menu = (
        <EntityActionMenuContent
          actionMenu={actionMenu}
          controller={controller}
          getActions={actionMenu.getActions}
          getFallbackHeader={getFallbackHeader}
        />
      );
    }
  }

  return { controller, targetProps, menu };
}
