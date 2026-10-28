import { type ReactNode } from "react";
import { ActionGroup } from "@crate/ui/primitives/ActionGroup";
import {
  PageHeaderLayout as SharedPageHeaderLayout,
  type PageHeaderLayoutProps,
} from "@crate/ui/domain/navigation/PageHeader";

export function PageHeaderLayout(props: PageHeaderLayoutProps) {
  return <SharedPageHeaderLayout {...props} data-slot="admin-page-header" />;
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
