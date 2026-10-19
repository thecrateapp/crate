import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { TopBarSearch } from "@/components/layout/topbar/TopBarSearch";
import { TopBarUserMenu } from "@/components/layout/topbar/TopBarUserMenu";
import { TopBarView } from "./TopBarView";
export function TopBar({
  hideMobileActions = false,
}: {
  hideMobileActions?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <TopBarView
      backLabel={t("topbar.back")}
      forwardLabel={t("topbar.forward")}
      onBack={() => navigate(-1)}
      onForward={() => navigate(1)}
      search={<TopBarSearch />}
      userMenu={<TopBarUserMenu />}
      hideMobileActions={hideMobileActions}
    />
  );
}
