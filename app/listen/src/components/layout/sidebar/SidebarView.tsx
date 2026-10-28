import type { ReactNode } from "react";
export function SidebarView({
  expanded,
  children,
}: {
  expanded: boolean;
  children: ReactNode;
}) {
  return (
    <aside
      className={`listen-desktop-sidebar z-app-sidebar fixed inset-y-0 left-0 ${expanded ? "w-52" : "w-14"} flex flex-col overflow-y-auto border-r border-border-quiet bg-surface-canvas transition-[width] duration-200`}
    >
      {children}
    </aside>
  );
}
