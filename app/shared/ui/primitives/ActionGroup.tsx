import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  type AnchorHTMLAttributes,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { Loader2 } from "@crate/ui/icons";
import { Button, type ButtonProps } from "@crate/ui/shadcn/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@crate/ui/shadcn/tooltip";

export function ActionGroup({
  children,
  label = "Actions",
}: {
  children: ReactNode;
  label?: string;
}) {
  if (Children.toArray(children).length === 0) return null;
  return (
    <TooltipProvider>
      <div
        data-slot="action-group"
        role="group"
        aria-label={label}
        className="flex max-w-full flex-wrap items-center justify-end gap-2"
      >
        {children}
      </div>
    </TooltipProvider>
  );
}

// Stable wrapper keeps a disabled native control discoverable without replacing its node.
function ActionTrigger({
  children,
  unavailable,
  label,
  ...props
}: Omit<ComponentProps<"span">, "children"> & {
  children: ReactElement<ComponentProps<"button">>;
  unavailable: boolean;
  label: string;
}) {
  return (
    <span
      {...props}
      role={unavailable ? "group" : undefined}
      aria-label={unavailable ? label : undefined}
      aria-disabled={unavailable || undefined}
      tabIndex={unavailable ? 0 : undefined}
      className="inline-flex rounded-md"
    >
      {cloneElement(children, {
        "aria-describedby":
          [children.props["aria-describedby"], props["aria-describedby"]]
            .filter(Boolean)
            .join(" ") || undefined,
      })}
    </span>
  );
}

function ActionHelp({
  children,
  label,
  tooltip = label,
  unavailable,
}: {
  children: ReactElement<ComponentProps<"button">>;
  label: string;
  tooltip?: string;
  unavailable: boolean;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <ActionTrigger
            unavailable={unavailable}
            label={label}
            title={tooltip}
          >
            {children}
          </ActionTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export type ActionButtonProps = Omit<
  ButtonProps,
  "size" | "variant" | "shape" | "className" | "aria-label" | "title"
> & { label: string; tooltip?: string };

export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(
  function ActionButton(
    {
      label,
      tooltip,
      disabled,
      loading = false,
      asChild = false,
      children,
      ...props
    },
    ref,
  ) {
    return (
      <ActionHelp
        label={label}
        tooltip={tooltip}
        unavailable={Boolean(disabled || loading)}
      >
        <Button
          {...props}
          asChild={asChild}
          ref={ref}
          disabled={disabled || loading}
          loading={false}
          aria-busy={loading || props["aria-busy"] || undefined}
          size="icon-lg"
          variant="ghost"
          className="aria-pressed:text-accent-action-hi"
          aria-label={label}
          title={tooltip ?? label}
        >
          {asChild && isValidElement<{ children?: ReactNode }>(children) ? (
            cloneElement(children, {
              children: loading ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                children.props.children
              ),
            })
          ) : loading ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            children
          )}
        </Button>
      </ActionHelp>
    );
  },
);

export interface ActionLinkProps
  extends Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    "aria-label" | "title" | "className"
  > {
  label: string;
  tooltip?: string;
  disabled?: boolean;
  loading?: boolean;
}

export const ActionLink = forwardRef<HTMLAnchorElement, ActionLinkProps>(
  function ActionLink(
    {
      label,
      tooltip,
      disabled,
      loading = false,
      href,
      children,
      "aria-describedby": describedBy,
      ...props
    },
    ref,
  ) {
    const unavailable = Boolean(disabled || loading || !href);
    return (
      <ActionHelp label={label} tooltip={tooltip} unavailable={unavailable}>
        <Button
          asChild
          disabled={unavailable}
          loading={loading}
          aria-describedby={describedBy}
          size="icon-lg"
          variant="ghost"
        >
          <a
            {...props}
            ref={ref}
            href={href || "#"}
            aria-label={label}
            title={tooltip ?? label}
          >
            {loading ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              children
            )}
          </a>
        </Button>
      </ActionHelp>
    );
  },
);
