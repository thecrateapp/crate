import { ErrorState, LoadingState } from "@crate/ui/domain/states";

import { JamLobbyView } from "@/components/jam/JamLobbyView";
import { JamRoomView } from "@/components/jam/JamRoomView";
import { useJamSessionController } from "@/hooks/use-jam-session-controller";
export function JamSession() {
  const { t, roomId, loading, error, room, lobbyViewProps, roomViewProps } =
    useJamSessionController();

  if (!roomId) {
    return <JamLobbyView {...lobbyViewProps} />;
  }

  if (loading) {
    return <LoadingState label={t("common.loadingShort")} />;
  }

  if (!room) {
    return (
      <ErrorState
        kind="unavailable"
        title={t("jam.room.unavailableTitle")}
        message={error || t("jam.room.unavailableDescription")}
        backTo="/jam"
        backLabel={t("jam.room.backToJam")}
        className="py-16"
      />
    );
  }

  return <JamRoomView {...roomViewProps} />;
}
