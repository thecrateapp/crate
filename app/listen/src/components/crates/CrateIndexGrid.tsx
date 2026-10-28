import type { ReactNode } from "react";

/** V2 crate-card geometry; coverflow/editor composition stays with its own views. */
export function CrateIndexGrid({
  children,
  testId,
}: {
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      data-slot="crate-index-grid"
      className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6"
    >
      {children}
    </div>
  );
}
