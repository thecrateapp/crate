import type { ReactNode } from "react";
import { FormField } from "@crate/ui/primitives/FormField";

export function UpcomingMonthGroupView({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <FormField
      kind="group"
      label={label}
      labelClassName="border-b border-border-quiet pb-2"
    >
      {(group) => (
        <div {...group} role="group" className="grid min-w-0 gap-2">
          {children}
        </div>
      )}
    </FormField>
  );
}
