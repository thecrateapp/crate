import { CRATE_ICON_SIZE, PanelLeftClose } from "@crate/ui/icons";
import { CrateLogo } from "@crate/ui/domain/brand/CrateLogo";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
interface SidebarBrandProps {
  expanded: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  collapseLabel: string;
  expandLabel: string;
}
export function SidebarBrand({
  expanded,
  onCollapse,
  onExpand,
  collapseLabel,
  expandLabel,
}: SidebarBrandProps) {
  return (
    <div
      className={`flex items-center py-4 ${expanded ? "gap-3 pl-4 pr-1" : "justify-center"}`}
    >
      {expanded ? (
        <>
          <CrateLogo
            title="Crate"
            effects={false}
            className="size-8 shrink-0"
          />
          <span className="flex-1 text-sm font-bold text-text-primary">
            Crate
          </span>
          <ActionButton onClick={onCollapse} label={collapseLabel}>
            <PanelLeftClose size={CRATE_ICON_SIZE.md} />
          </ActionButton>
        </>
      ) : (
        <ActionButton onClick={onExpand} label={expandLabel}>
          <CrateLogo effects={false} className="size-6" />
        </ActionButton>
      )}
    </div>
  );
}
