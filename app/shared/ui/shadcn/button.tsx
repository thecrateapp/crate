import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { Loader2 } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-medium transition-[color,background-color,border-color,box-shadow,opacity,transform] outline-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-invalid:border-state-danger [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        default:
          "rounded-md bg-accent-action text-accent-action-foreground shadow-action hover:bg-accent-action-hover focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
        destructive:
          "rounded-md bg-state-danger text-state-danger-foreground hover:bg-state-danger/90 dark:bg-state-danger/60 focus-visible:border-border-focus focus-visible:shadow-focus",
        "danger-soft":
          "rounded-md border border-state-danger/25 bg-state-danger/10 text-state-danger-text hover:border-state-danger/40 hover:bg-state-danger/15 focus-visible:border-border-focus focus-visible:shadow-focus",
        outline:
          "rounded-md border border-border-subtle bg-surface-control text-text-primary shadow-control-inset hover:bg-surface-control-hover hover:text-text-primary focus-visible:border-border-focus focus-visible:shadow-focus",
        secondary:
          "rounded-md bg-surface-control text-text-primary hover:bg-surface-control-hover focus-visible:border-border-focus focus-visible:shadow-focus",
        ghost:
          "rounded-md text-text-secondary hover:bg-surface-control hover:text-text-primary dark:hover:bg-surface-control-hover focus-visible:border-border-focus focus-visible:shadow-focus",
        link: "text-accent-action underline-offset-4 hover:underline focus-visible:border-border-focus focus-visible:shadow-focus",
      },
      size: {
        default: "h-10 px-4 py-2 text-sm has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-[14px]",
        sm: "h-8 gap-1.5 rounded-md px-3 text-sm has-[>svg]:px-2.5 [&_svg:not([class*='size-'])]:size-4",
        lg: "h-11 rounded-md px-6 text-sm has-[>svg]:px-4",
        icon: "size-10 rounded-md",
        "icon-xs":
          "size-6 rounded-md [&_svg:not([class*='size-'])]:size-[14px]",
        "icon-sm": "size-8 rounded-md [&_svg:not([class*='size-'])]:size-4",
        "icon-lg": "size-11 rounded-md [&_svg:not([class*='size-'])]:size-5",
      },
      shape: {
        rect: "",
        pill: "rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
  };

function Button({
  className,
  variant = "default",
  size = "default",
  shape = "rect",
  asChild = false,
  loading = false,
  children,
  ...props
}: ButtonProps) {
  const sharedProps = {
    "data-slot": "button",
    "data-variant": variant,
    "data-size": size,
    "data-shape": shape,
    "aria-busy": loading || undefined,
    className: cn(buttonVariants({ variant, size, shape, className })),
  };

  if (asChild) {
    return (
      <Slot.Root
        {...sharedProps}
        aria-disabled={props.disabled || loading || undefined}
        {...props}
      >
        {children}
      </Slot.Root>
    );
  }

  return (
    <button
      {...sharedProps}
      {...props}
      type={props.type ?? "button"}
      disabled={props.disabled || loading}
    >
      {loading ? (
        <Loader2
          data-slot="button-spinner"
          aria-hidden="true"
          className="animate-spin"
        />
      ) : null}
      {children}
    </button>
  );
}

export { Button, buttonVariants };
export type { ButtonProps };
