import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { Loader2 } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { api } from "@/lib/api";

export function CrateInvite() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token } = useParams<{ token: string }>();

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api<{ crate_id: string }>(`/api/crates/invites/${token}/accept`, "POST", {})
      .then((response) => {
        if (cancelled) return;
        toast.success(t("crateInvite.toasts.joined"));
        navigate(`/crate/${response.crate_id}`, { replace: true });
      })
      .catch(() => {
        if (cancelled) return;
        toast.error(t("crateInvite.toasts.invalid"));
        navigate("/collection?tab=crates", { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, t, token]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <Loader2 size={22} className="animate-spin text-primary" />
      <div>
        <p className="text-lg font-medium text-foreground">
          {t("crateInvite.title")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("crateInvite.subtitle")}
        </p>
      </div>
    </div>
  );
}
