import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
} from "react";

import { cn } from "@crate/ui/lib/cn";

export const APP_FLOATING_SURFACE_BASE =
  "crate-overlay-surface rounded-panel border border-border-quiet bg-surface-popover shadow-popover";
export const APP_POPOVER_SURFACE = `z-app-popover ${APP_FLOATING_SURFACE_BASE}`;
export const APP_CONTEXT_MENU_SURFACE = `z-app-context-menu ${APP_FLOATING_SURFACE_BASE}`;
export const APP_DROPDOWN_SURFACE = `z-app-dropdown ${APP_FLOATING_SURFACE_BASE}`;

interface AppPopoverProps extends ComponentPropsWithoutRef<"div"> {
  layer?: "popover" | "dropdown" | "context";
}

export const AppPopover = forwardRef<HTMLDivElement, AppPopoverProps>(
  function AppPopover({ className, layer = "dropdown", ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          layer === "dropdown"
            ? APP_DROPDOWN_SURFACE
            : layer === "context"
              ? APP_CONTEXT_MENU_SURFACE
              : APP_POPOVER_SURFACE,
          className,
        )}
        {...props}
      />
    );
  },
);

export function AppPopoverDivider({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn("my-1 border-t border-border-quiet-subtle", className)}
      {...props}
    />
  );
}

interface AppMenuButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  danger?: boolean;
}

export function AppMenuButton({
  className,
  danger = false,
  type = "button",
  ...props
}: AppMenuButtonProps) {
  return (
    <button
      type={type}
      data-danger={danger || undefined}
      className={cn(
        "crate-overlay-menu-item flex w-full items-center gap-3 px-3 text-left",
        className,
      )}
      {...props}
    />
  );
}
