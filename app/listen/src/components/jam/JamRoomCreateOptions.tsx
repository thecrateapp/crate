import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { CRATE_ICON_SIZE, Globe2, Lock } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import type { JamQueueMode } from "@/pages/jam-reducer";

import type { JamRoomCreatePanelProps } from "./jam-lobby-types";

export function PlaybackModeSelect({
  roomQueueMode,
  onRoomQueueModeChange,
  setRoomPermanent,
}: Pick<
  JamRoomCreatePanelProps,
  "roomQueueMode" | "onRoomQueueModeChange" | "setRoomPermanent"
>) {
  const { t } = useTranslation();

  return (
    <div className="crate-form-field">
      <MonoLabel as="span">{t("jam.lobby.playbackMode")}</MonoLabel>
      <SegmentedControl
        as="radio"
        label={t("jam.lobby.playbackMode")}
        value={roomQueueMode}
        onValueChange={(value) => {
          const nextMode = value as JamQueueMode;
          onRoomQueueModeChange(nextMode);
          if (nextMode === "auto_dj") setRoomPermanent(true);
        }}
        items={[
          { value: "manual", label: t("jam.room.djMode") },
          { value: "auto", label: t("jam.room.autoMode") },
          { value: "auto_dj", label: t("jam.room.autoDjMode") },
        ]}
      />
    </div>
  );
}

export function RoomVisibilityOptions({
  roomVisibility,
  setRoomVisibility,
}: Pick<JamRoomCreatePanelProps, "roomVisibility" | "setRoomVisibility">) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <button
        type="button"
        aria-pressed={roomVisibility === "private"}
        onClick={() => setRoomVisibility("private")}
        className={`jam-toggle-option flex items-center gap-2 rounded-lg p-3 text-left text-sm transition-colors ${
          roomVisibility === "private" ? "" : "text-text-muted"
        }`}
        data-active={roomVisibility === "private" ? "true" : "false"}
      >
        <Lock size={CRATE_ICON_SIZE.sm} />
        {t("jam.visibility.inviteOnly")}
      </button>
      <button
        type="button"
        aria-pressed={roomVisibility === "public"}
        onClick={() => setRoomVisibility("public")}
        className={`jam-toggle-option flex items-center gap-2 rounded-lg p-3 text-left text-sm transition-colors ${
          roomVisibility === "public" ? "" : "text-text-muted"
        }`}
        data-active={roomVisibility === "public" ? "true" : "false"}
      >
        <Globe2 size={CRATE_ICON_SIZE.sm} />
        {t("jam.visibility.public")}
      </button>
    </div>
  );
}
