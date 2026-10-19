import {
  Children,
  cloneElement,
  type ComponentProps,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@crate/ui/lib/cn";
import { Button, type ButtonProps } from "@crate/ui/shadcn/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@crate/ui/shadcn/tooltip";

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

export function PageHeaderActions({
  children,
  label = "Page actions",
}: {
  children: ReactNode;
  label?: string;
}) {
  if (Children.toArray(children).length === 0) return null;
  return (
    <TooltipProvider>
      <div
        role="group"
        aria-label={label}
        className="flex max-w-full flex-wrap items-center justify-end gap-2"
      >
        {children}
      </div>
    </TooltipProvider>
  );
}

// Keep the same native button through availability changes. Radix supplies its tooltip
// description to the wrapper; forward it to the button as well for the enabled trigger.
function HeaderActionTrigger({
  children,
  disabled,
  label,
  ...triggerProps
}: Omit<ComponentProps<"span">, "children"> & {
  children: ReactElement<ButtonProps>;
  disabled?: boolean;
  label: string;
}) {
  return (
    <span
      {...triggerProps}
      role={disabled ? "group" : undefined}
      aria-label={disabled ? label : undefined}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? 0 : undefined}
      className="inline-flex rounded-md"
    >
      {cloneElement(children, {
        "aria-describedby": triggerProps["aria-describedby"],
      })}
    </span>
  );
}

type PageHeaderActionProps = Omit<
  ButtonProps,
  | "size"
  | "variant"
  | "shape"
  | "className"
  | "loading"
  | "aria-label"
  | "title"
> & { label: string; tooltip?: string };
export function PageHeaderAction({
  label,
  tooltip = label,
  children,
  disabled,
  ...props
}: PageHeaderActionProps) {
  const control = (
    <Button
      {...props}
      disabled={disabled}
      loading={false}
      size="icon-lg"
      variant="ghost"
      className="aria-pressed:text-accent-action-hi"
      aria-label={label}
      title={tooltip}
    >
      {children}
    </Button>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <HeaderActionTrigger disabled={disabled} label={label} title={tooltip}>
          {control}
        </HeaderActionTrigger>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
