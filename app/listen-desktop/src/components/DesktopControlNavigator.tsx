import { useEffect } from "react";
import { useNavigate } from "react-router";

import {
  DESKTOP_CONTROL_COMMAND_EVENT,
  parseDesktopControlCommand,
} from "@/lib/desktop-control";
import { desktopRefPagePath } from "@/lib/desktop-control-search";

/**
 * Opens the page a desktop widget asked for with `{"cmd":"show","item":ref}`
 * on the control socket: the shell has already raised the window, this
 * navigates to the artist, the album, or a track's album with the track
 * highlighted. Mounted inside the desktop router.
 */
export function DesktopControlNavigator() {
  const navigate = useNavigate();

  useEffect(() => {
    const onCommand = (event: Event) => {
      const command = parseDesktopControlCommand(
        (event as CustomEvent<unknown>).detail,
      );
      if (command?.cmd !== "show") return;
      const path = desktopRefPagePath(command.item);
      if (path) navigate(path);
    };
    window.addEventListener(DESKTOP_CONTROL_COMMAND_EVENT, onCommand);
    return () =>
      window.removeEventListener(DESKTOP_CONTROL_COMMAND_EVENT, onCommand);
  }, [navigate]);

  return null;
}
