import { ChevronLeft, ChevronRight, CRATE_ICON_SIZE } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { IconButton } from "@crate/ui/primitives/IconButton";

import { TopBarSearch } from "@/components/layout/topbar/TopBarSearch";
import { TopBarUserMenu } from "@/components/layout/topbar/TopBarUserMenu";

const NAV_BUTTON_CLASS_NAME =
  "text-text-secondary hover:translate-y-0 hover:text-text-primary hover:drop-shadow-none";

interface TopBarProps {
  hideMobileActions?: boolean;
}

export function TopBar({ hideMobileActions = false }: TopBarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const backLabel = t("topbar.back");
  const forwardLabel = t("topbar.forward");

  return (
    <div className="flex h-16 w-full items-center gap-2 px-3 pointer-events-none sm:gap-4 sm:px-4">
      <div className="flex shrink-0 items-center gap-2 pointer-events-auto">
        <IconButton
          onClick={() => navigate(-1)}
          className={`${NAV_BUTTON_CLASS_NAME} size-11 touch-manipulation md:size-10`}
          label={backLabel}
        >
          <ChevronLeft
            size={CRATE_ICON_SIZE.navMobile}
            className="md:size-[21px]"
          />
        </IconButton>
        <IconButton
          onClick={() => navigate(1)}
          className={`${NAV_BUTTON_CLASS_NAME} hidden size-10 md:inline-flex`}
          label={forwardLabel}
        >
          <ChevronRight size={CRATE_ICON_SIZE.nav} className="size-[21px]" />
        </IconButton>
      </div>

      <div className="hidden md:block flex-1" />

      {hideMobileActions ? null : (
        <div
          data-testid="topbar-actions"
          className="flex min-w-0 flex-1 items-center gap-3 md:flex-none md:gap-4 pointer-events-auto"
        >
          <TopBarSearch />
          <TopBarUserMenu />
        </div>
      )}
    </div>
  );
}
