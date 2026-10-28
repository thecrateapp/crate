import { useId, type ReactNode } from "react";
import { SectionHeader } from "@crate/ui/domain/lists";

/** A public-profile content region, not an independently styled card. */
export function ProfileSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="grid min-w-0 gap-4 border-t border-border-quiet pt-6"
    >
      <SectionHeader
        id={id}
        title={title}
        subtitle={description}
        action={action}
      />
      <div className="min-w-0">{children}</div>
    </section>
  );
}
