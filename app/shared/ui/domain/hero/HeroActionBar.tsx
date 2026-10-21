import { TooltipHint } from "@crate/ui/shadcn/tooltip";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { CRATE_ICON_SIZE, Loader2, MoreHorizontal } from "@crate/ui/icons";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { cn } from "@crate/ui/lib/cn";

import { ItemActionMenu } from "../actions/ItemActionMenu";
import {
  useItemActionMenu,
  type ItemActionMenuEntry,
} from "../actions/useItemActionMenu";
import type {
  ContextMenuHeader,
  ContextMenuMediaImageRenderer,
} from "../actions/types";

export const HERO_PRIMARY_ACTIONS_GROUP_CLASS =
  "grid min-w-0 max-w-full grid-cols-2 gap-3 md:flex md:flex-wrap md:items-center md:gap-3";

export const HERO_PRIMARY_ACTION_CLASS =
  "flex min-h-12 min-w-0 max-w-full shrink-0 items-center justify-center gap-2 rounded-full border border-accent-action bg-transparent px-5 text-sm whitespace-normal py-2 font-semibold text-accent-action transition-[color,border-color] hover:border-accent-action-hi hover:text-accent-action-hi disabled:cursor-not-allowed disabled:opacity-45 md:px-7 md:text-body";

export const HERO_NEUTRAL_ACTION_CLASS =
  "flex min-h-12 min-w-0 max-w-full shrink-0 items-center justify-center gap-2 rounded-full bg-text-primary/[0.08] px-5 text-sm whitespace-normal py-2 font-semibold text-text-primary shadow-control-inset transition-[background-color,color,filter,transform] hover:-translate-y-px hover:bg-text-primary/[0.12] hover:text-accent-action hover:drop-shadow-accent-action disabled:cursor-not-allowed disabled:opacity-45 md:w-auto md:px-7";

export const HERO_SECONDARY_ACTION_CLASS =
  "flex min-h-14 min-w-14 max-w-full shrink-0 touch-manipulation flex-col items-center justify-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-text-primary/62 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action-hover disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0 disabled:hover:drop-shadow-none";

export const HERO_SECONDARY_ACTION_ACTIVE_CLASS =
  "text-accent-action drop-shadow-accent-action";

const SECONDARY_GROUP_CLASS: Record<HeroSecondaryLayout, string> = {
  fixed:
    "empty:hidden min-w-0 max-w-full grid grid-cols-5 items-start gap-2 md:ml-auto md:flex md:flex-wrap md:items-center md:gap-4",
  fill: "empty:hidden min-w-0 max-w-full grid grid-flow-col auto-cols-fr items-start gap-2 md:ml-auto md:flex md:flex-wrap md:items-center md:gap-4",
};

export type HeroPrimaryTone = "accent" | "neutral";
export type HeroSecondaryLayout = "fixed" | "fill";

export interface HeroPrimaryAction {
  key: string;
  label: string;
  icon?: ReactNode;
  tone?: HeroPrimaryTone;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  ariaLabel?: string;
  className?: string;
}

export interface HeroSecondaryAction {
  key: string;
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  ariaLabel?: string;
  title?: string;
  className?: string;
}

export interface HeroActionMenu {
  actions: ItemActionMenuEntry[];
  header?: ContextMenuHeader;
  sheetLabel?: string;
  surfaceClassName?: string;
  renderMediaImage?: ContextMenuMediaImageRenderer;
  onOpenChange?: (open: boolean) => void;
}

export interface HeroActionBarProps {
  primaryActions?: HeroPrimaryAction[];
  primaryExtra?: ReactNode;
  secondaryLeading?: ReactNode;
  secondaryActions?: HeroSecondaryAction[];
  secondaryExtra?: ReactNode;
  secondaryLayout?: HeroSecondaryLayout;
  menu?: HeroActionMenu;
  moreLabel?: string;
  mobileMenuPortal?: boolean;
  primaryLabel?: string;
  secondaryLabel?: string;
  className?: string;
}

function HeroActionMenuControl({
  menu,
  moreLabel,
  mobileMenuPortal,
}: {
  menu: HeroActionMenu;
  moreLabel: string;
  mobileMenuPortal: boolean;
}) {
  const onOpenChangeRef = useRef(menu.onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = menu.onOpenChange;
  });
  const handleOpenChange = useCallback((open: boolean) => {
    onOpenChangeRef.current?.(open);
  }, []);
  const controller = useItemActionMenu(menu.actions, {
    placement: "bottom-end",
    onOpenChange: handleOpenChange,
  });
  if (!controller.hasActions) return null;

  const usePortal =
    mobileMenuPortal &&
    !controller.isDesktop &&
    typeof document !== "undefined";

  const trigger = usePortal ? (
    <div
      className="fixed z-app-header"
      style={{
        top: "calc(var(--listen-safe-top, 0px) + 0.625rem)",
        right: "max(1rem, var(--listen-safe-right, 0px))",
      }}
    >
      <TooltipHint content={moreLabel}>
        <button
          ref={controller.triggerRef}
          type="button"
          aria-label={moreLabel}
          aria-haspopup="menu"
          aria-expanded={controller.open}
          data-testid="hero-mobile-menu-trigger"
          onClick={controller.openFromTrigger}
          onContextMenu={controller.handleContextMenu}
          className="flex size-11 touch-manipulation items-center justify-center rounded-full text-text-primary/72 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action-hover"
        >
          <MoreHorizontal
            size={CRATE_ICON_SIZE.navMobile}
            className="rotate-90"
            aria-hidden="true"
          />
        </button>
      </TooltipHint>
    </div>
  ) : (
    <TooltipHint content={moreLabel}>
      <button
        ref={controller.triggerRef}
        type="button"
        aria-label={moreLabel}
        aria-haspopup="menu"
        aria-expanded={controller.open}
        data-testid="hero-menu-trigger"
        onClick={controller.openFromTrigger}
        onContextMenu={controller.handleContextMenu}
        className={HERO_SECONDARY_ACTION_CLASS}
      >
        <MoreHorizontal size={CRATE_ICON_SIZE.lg} aria-hidden="true" />
        <MonoLabel
          as="span"
          className="max-w-full whitespace-normal wrap-anywhere text-inherit"
        >
          {moreLabel}
        </MonoLabel>
      </button>
    </TooltipHint>
  );

  return (
    <>
      {usePortal ? createPortal(trigger, document.body) : trigger}
      <ItemActionMenu
        actions={menu.actions}
        header={menu.header}
        open={controller.open}
        position={controller.position}
        menuRef={controller.menuRef}
        onClose={controller.close}
        renderMediaImage={menu.renderMediaImage}
        surfaceClassName={menu.surfaceClassName}
        sheetLabel={menu.sheetLabel}
      />
    </>
  );
}

export function HeroActionBar({
  primaryActions = [],
  primaryExtra,
  secondaryLeading,
  secondaryActions = [],
  secondaryExtra,
  secondaryLayout = "fixed",
  menu,
  moreLabel = "More",
  mobileMenuPortal = true,
  primaryLabel,
  secondaryLabel,
  className,
}: HeroActionBarProps) {
  const hasPrimary = primaryActions.length > 0 || Boolean(primaryExtra);
  const hasSecondary =
    secondaryActions.length > 0 ||
    Boolean(secondaryLeading) ||
    Boolean(secondaryExtra) ||
    Boolean(
      menu?.actions.some(
        (entry) =>
          entry.type == null ||
          entry.type === "action" ||
          entry.type === "disclosure",
      ),
    );

  if (!hasPrimary && !hasSecondary) return null;

  return (
    <div
      className={cn(
        "mx-auto flex min-w-0 w-full max-w-content font-[family-name:var(--font-brand)] flex-col gap-5 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-6",
        className,
      )}
      data-testid="hero-action-bar"
    >
      {hasPrimary ? (
        <div
          className={HERO_PRIMARY_ACTIONS_GROUP_CLASS}
          role={primaryLabel ? "group" : undefined}
          aria-label={primaryLabel}
        >
          {primaryActions.map((action) => (
            <button
              key={action.key}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled || action.loading}
              aria-label={action.ariaLabel}
              aria-busy={action.loading || undefined}
              className={cn(
                action.tone === "neutral"
                  ? HERO_NEUTRAL_ACTION_CLASS
                  : HERO_PRIMARY_ACTION_CLASS,
                action.className,
              )}
            >
              {action.loading ? (
                <Loader2
                  size={CRATE_ICON_SIZE.md}
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : (
                action.icon
              )}
              <span className="min-w-0 whitespace-normal wrap-anywhere">
                {action.label}
              </span>
            </button>
          ))}
          {primaryExtra}
        </div>
      ) : null}
      {hasSecondary ? (
        <div
          className={SECONDARY_GROUP_CLASS[secondaryLayout]}
          role={secondaryLabel ? "group" : undefined}
          aria-label={secondaryLabel}
        >
          {secondaryLeading}
          {secondaryActions.map((action) => (
            <TooltipHint content={action.title} key={action.key}>
              <button
                key={action.key}
                type="button"
                onClick={action.onClick}
                disabled={action.disabled}
                aria-label={action.ariaLabel}
                aria-pressed={
                  action.active === undefined ? undefined : action.active
                }
                className={cn(
                  HERO_SECONDARY_ACTION_CLASS,
                  action.active && HERO_SECONDARY_ACTION_ACTIVE_CLASS,
                  action.className,
                )}
              >
                {action.icon}
                <MonoLabel
                  as="span"
                  className="max-w-full whitespace-normal wrap-anywhere text-inherit"
                >
                  {action.label}
                </MonoLabel>
              </button>
            </TooltipHint>
          ))}
          {secondaryExtra}
          {menu ? (
            <HeroActionMenuControl
              menu={menu}
              moreLabel={moreLabel}
              mobileMenuPortal={mobileMenuPortal}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
