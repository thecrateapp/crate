import { memo, type ReactNode } from "react";

import { CRATE_ICON_SIZE } from "@crate/ui/icons";
import { ItemActionMenuButton } from "@crate/ui/domain/actions/ItemActionMenu";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { cn } from "@crate/ui/lib/cn";

import { EntityPrimaryAction } from "./EntityPrimaryAction";
import type {
  EntityCover,
  EntityMenuButtonMode,
  EntityMenuProps,
  EntityPrimaryActionProps,
  EntityShape,
} from "./types";
import { useEntityMenu } from "./useEntityMenu";

export type EntityRowDensity = "default" | "compact";

export interface EntityRowClassNames {
  root?: string;
  action?: string;
  title?: string;
  subtitle?: string;
  meta?: string;
  trailing?: string;
  menuButton?: string;
}

export interface EntityRowProps
  extends EntityPrimaryActionProps,
    EntityMenuProps {
  title: string;
  subtitle?: ReactNode;
  meta?: ReactNode;
  titleAccessory?: ReactNode;
  leading?: ReactNode;
  cover?: EntityCover;
  shape?: EntityShape;
  rank?: number;
  trailing?: ReactNode;
  density?: EntityRowDensity;
  active?: boolean;
  selected?: boolean;
  disabled?: boolean;
  disableItemActionTarget?: boolean;
  className?: string;
  classNames?: EntityRowClassNames;
}

const MENU_BUTTON_CLASS_NAME: Record<
  Exclude<EntityMenuButtonMode, "none">,
  string
> = {
  hover:
    "opacity-75 transition-opacity hover:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-focus-within/row:opacity-100",
  always: "opacity-100",
};

export const EntityRow = memo(function EntityRow({
  title,
  subtitle,
  meta,
  titleAccessory,
  leading,
  cover,
  shape = "square",
  rank,
  trailing,
  density = "default",
  active = false,
  selected = false,
  disabled = false,
  disableItemActionTarget = false,
  onOpen,
  href,
  external,
  openLabel,
  actionMenu,
  renderMenu,
  menuButton = "hover",
  menuLabel = "More actions",
  className,
  classNames,
}: EntityRowProps) {
  const compact = density === "compact";
  const { controller, targetProps, menu } = useEntityMenu({
    actionMenu,
    renderMenu,
    disabled: disabled || external,
    disableItemActionTarget,
    getFallbackHeader: () => ({
      type: "media",
      title,
      subtitle: typeof subtitle === "string" ? subtitle : undefined,
      imageUrl: cover?.src ?? null,
      imageAlt: title,
      imageShape: shape === "circle" ? "circle" : "square",
      fallbackIcon: cover?.fallbackIcon,
    }),
  });
  const leadingNode =
    leading ??
    (cover ? (
      <MediaCover
        {...cover}
        alt={cover.alt ?? ""}
        iconSize={cover.iconSize ?? CRATE_ICON_SIZE.md}
        shape={shape}
        className={cn("shrink-0", compact ? "size-10" : "size-12")}
      />
    ) : null);

  return (
    <article
      className={cn(
        "item-action-target group/row relative flex min-w-0 items-center rounded-lg text-left transition-colors hover:bg-text-primary/5",
        compact
          ? "gap-2 px-2 py-1.5"
          : "gap-[var(--content-row-gap)] px-3 py-[var(--content-row-padding-y)]",
        selected && "bg-text-primary/5",
        disabled && "opacity-50",
        className,
        classNames?.root,
      )}
      data-density={density}
      data-active={active || undefined}
      data-selected={selected || undefined}
      data-disabled={disabled || undefined}
      {...targetProps}
    >
      {rank != null ? (
        <span
          data-slot="entity-rank"
          className="w-6 shrink-0 text-right text-xs tabular-nums text-text-muted"
        >
          {rank}
        </span>
      ) : null}
      <EntityPrimaryAction
        onOpen={onOpen}
        href={href}
        external={external}
        openLabel={openLabel}
        disabled={disabled}
        current={active}
        className={cn(
          "flex min-w-0 flex-1 items-center rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed",
          compact ? "gap-2" : "gap-[var(--content-row-gap)]",
          classNames?.action,
        )}
      >
        {leadingNode}
        <span className="block min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-[var(--content-row-inline-gap)]">
            <span
              className={cn(
                "block min-w-0 truncate text-sm font-medium",
                active ? "text-accent-action" : "text-text-primary",
                classNames?.title,
              )}
            >
              {title}
            </span>
            {titleAccessory}
          </span>
          {subtitle != null ? (
            <span
              className={cn(
                "block truncate text-xs text-text-muted",
                classNames?.subtitle,
              )}
            >
              {subtitle}
            </span>
          ) : null}
          {meta != null ? (
            <span
              className={cn(
                "block truncate text-xs tabular-nums text-text-muted",
                classNames?.meta,
              )}
            >
              {meta}
            </span>
          ) : null}
        </span>
      </EntityPrimaryAction>
      {trailing != null ? (
        <div
          data-slot="entity-trailing"
          className={cn(
            "flex shrink-0 items-center gap-2",
            classNames?.trailing,
          )}
        >
          {trailing}
        </div>
      ) : null}
      {menuButton !== "none" ? (
        <ItemActionMenuButton
          buttonRef={controller.triggerRef}
          hasActions={controller.hasActions}
          onClick={controller.openFromTrigger}
          expanded={controller.open}
          title={menuLabel}
          className={cn(
            "shrink-0",
            compact ? "size-8" : "size-9",
            MENU_BUTTON_CLASS_NAME[menuButton],
            classNames?.menuButton,
          )}
        />
      ) : null}
      {menu}
    </article>
  );
});
