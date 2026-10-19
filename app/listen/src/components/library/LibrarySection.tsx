import { useId, type ReactNode } from "react";
import { SectionHeader } from "@crate/ui/domain/lists/SectionHeader";
import { cn } from "@crate/ui/lib/cn";

export function LibrarySection({
  title,
  subtitle,
  actions,
  titleId,
  as = "h2",
  className,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  titleId?: string;
  as?: "h2" | "h3";
  className?: string;
  children?: ReactNode;
}) {
  const generated = useId();
  const id = titleId ?? generated;
  return (
    <section
      aria-labelledby={id}
      data-slot="library-section"
      className={cn("space-y-4", className)}
    >
      <SectionHeader
        id={id}
        as={as}
        title={title}
        subtitle={subtitle}
        action={actions}
      />
      {children}
    </section>
  );
}
