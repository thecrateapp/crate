import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@crate/ui/lib/cn";
import { ActionGroup } from "@crate/ui/primitives/ActionGroup";

export function PageHeaderLayout({
  as: Tag = "div",
  artwork,
  actions,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: "div" | "header" | "section";
  artwork?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Tag
      {...props}
      data-slot="admin-page-header"
      className={cn("@container min-w-0 w-full", className)}
    >
      <div className="flex min-w-0 flex-col gap-5 @2xl:flex-row @2xl:items-start">
        {artwork ? <div className="shrink-0">{artwork}</div> : null}
        <div className="min-w-0 flex-1">{children}</div>
        {actions ? (
          <div
            data-slot="header-actions-position"
            className="order-first max-w-full self-end empty:hidden @2xl:order-none @2xl:self-start"
          >
            {actions}
          </div>
        ) : null}
      </div>
    </Tag>
  );
}

// Compatibility names: geometry, tooltip and disabled discovery now belong to @crate/ui.
export { ActionButton as PageHeaderAction } from "@crate/ui/primitives/ActionGroup";
export function PageHeaderActions({
  children,
  label = "Page actions",
}: {
  children: ReactNode;
  label?: string;
}) {
  return <ActionGroup label={label}>{children}</ActionGroup>;
}
