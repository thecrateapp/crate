import { useTranslation } from "react-i18next";
import { Button } from "@crate/ui/shadcn/button";
import { AuthFrame } from "./AuthFrame";
export function AuthCallbackView({
  desktopDeepLink,
  embedded,
}: {
  desktopDeepLink: string;
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <AuthFrame
      title={t("authCallback.title")}
      subtitle={t("authCallback.desktopHint")}
      embedded={embedded}
    >
      <Button asChild>
        <a href={desktopDeepLink}>{t("authCallback.openCrate")}</a>
      </Button>
    </AuthFrame>
  );
}
