import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";

import { useEqualizer } from "@/hooks/use-equalizer";

import { EqualizerPanelView } from "./EqualizerPanelSections";

interface EqualizerPanelProps {
  /** Shown as a header action — optional, typically the close button. */
  onClose?: () => void;
}

export function EqualizerPanel({ onClose }: EqualizerPanelProps) {
  const { t } = useTranslation();
  const eq = useEqualizer();
  const [saving, setSaving] = useState(false);

  const handleSaveTrack = async () => {
    setSaving(true);
    try {
      const result = await eq.saveForCurrentTrack();
      if (result) notify.success(t("player.equalizer.toasts.saved"));
      else notify.error(t("player.equalizer.toasts.cannotSave"));
    } catch (error) {
      console.error("[eq] failed to save track preset", error);
      notify.error(t("player.equalizer.toasts.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleClearTrack = async () => {
    setSaving(true);
    try {
      await eq.clearCurrentTrackPreset();
      notify.success(t("player.equalizer.toasts.cleared"));
    } catch (error) {
      console.error("[eq] failed to clear track preset", error);
      notify.error(t("player.equalizer.toasts.clearFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <EqualizerPanelView
      eq={eq}
      onClose={onClose}
      onClear={() => void handleClearTrack()}
      onSave={() => void handleSaveTrack()}
      saving={saving}
      t={t}
    />
  );
}
