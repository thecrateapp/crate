import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";

import { ToggleRow } from "@/components/settings/SettingsPrimitives";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";

export function AccountPulseListingField() {
  const { t } = useTranslation();
  const { user, refetch } = useAuth();
  const [listed, setListed] = useState(user?.pulse_listed !== false);

  async function updateListing(next: boolean) {
    setListed(next);
    try {
      await api("/api/auth/profile", "PUT", { pulse_listed: next });
      await refetch();
    } catch {
      setListed(!next);
      notify.error(t("settings.account.toasts.pulseListedFailed"));
    }
  }

  return (
    <ToggleRow
      label={t("settings.account.pulseListed")}
      description={t("settings.account.pulseListedDescription")}
      checked={listed}
      onChange={(next) => void updateListing(next)}
    />
  );
}
