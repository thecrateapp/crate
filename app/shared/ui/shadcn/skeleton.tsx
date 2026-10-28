import { cn } from "@crate/ui/lib/cn";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("crate-skeleton rounded-md", className)}
      {...props}
    />
  );
}

export { Skeleton };
