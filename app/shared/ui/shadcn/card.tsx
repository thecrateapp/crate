import * as React from "react";

import { cn } from "@crate/ui/lib/cn";

function Card({
  as: Element = "div",
  className,
  ...props
}: React.ComponentProps<"div"> & { as?: "div" | "section" | "article" }) {
  return (
    <Element
      data-slot="card"
      className={cn(
        "flex min-w-0 flex-col gap-6 wrap-anywhere rounded-panel border border-border-quiet bg-surface-object py-6 text-text-primary",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid min-w-0 auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto] [.border-b]:border-border-quiet [.border-b]:pb-6",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({
  as: Element = "div",
  className,
  ...props
}: React.ComponentProps<"div"> & { as?: "div" | "h2" | "h3" | "h4" }) {
  return (
    <Element
      data-slot="card-title"
      className={cn(
        "min-w-0 wrap-anywhere font-[family-name:var(--font-brand)] text-base font-semibold leading-6 tracking-tight",
        className,
      )}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("min-w-0 text-sm text-text-muted/90", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 min-w-0 max-w-full self-start justify-self-end",
        className,
      )}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("min-w-0 px-6", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-3 px-6 [.border-t]:border-border-quiet [.border-t]:pt-6",
        className,
      )}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
};
