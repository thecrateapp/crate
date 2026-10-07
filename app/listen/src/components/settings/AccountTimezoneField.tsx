import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";
import { FormField } from "@crate/ui/primitives/FormField";
import { Button } from "@crate/ui/shadcn/button";

import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { deviceTimezone } from "@/lib/device-timezone";

export function AccountTimezoneField() {
  const { t } = useTranslation();
  const { user, refetch } = useAuth();
  const [saving, setSaving] = useState(false);
  const current = user?.timezone ?? null;
  const device = deviceTimezone();

  async function applyDeviceTimezone() {
    if (!device) return;
    setSaving(true);
    try {
      await api("/api/auth/profile", "PUT", { timezone: device });
      notify.success(t("settings.account.toasts.timezoneUpdated"));
      await refetch();
    } catch {
      notify.error(t("settings.account.toasts.timezoneUpdateFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormField
      label={t("settings.account.timezone")}
      hint={t("settings.account.timezoneDescription")}
      className="gap-2"
      labelClassName="text-xs font-normal text-text-muted"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span
          className="text-sm text-text-primary"
          data-testid="account-timezone"
        >
          {current ?? t("settings.account.timezoneUnset")}
        </span>
        {device && device !== current ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={applyDeviceTimezone}
          >
            {t("settings.account.timezoneUseDevice", { zone: device })}
          </Button>
        ) : null}
      </div>
    </FormField>
  );
}
