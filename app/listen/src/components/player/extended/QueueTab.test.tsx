import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";
import {
  PlayerActionsContext,
  PlayerProgressContext,
  PlayerStateContext,
} from "@/contexts/player-context";
import {
  createMockPlayerActions,
  createMockPlayerState,
  createMockTrack,
} from "@/test/render-with-listen-providers";

const { queueRowRender } = vi.hoisted(() => ({
  queueRowRender: vi.fn(),
}));

vi.mock("@/components/player/QueueTrackRow", () => ({
  QueueTrackRow: () => {
    queueRowRender();
    return null;
  },
}));

import { QueueTab } from "./QueueTab";

const currentTrack = createMockTrack({ id: "current-track" });
const nextTrack = createMockTrack({ id: "next-track" });
const playerActions = createMockPlayerActions({
  currentTrack,
  queue: [currentTrack, nextTrack],
});
const playerState = createMockPlayerState({ isPlaying: true });

function queueTree(currentTime: number) {
  return (
    <I18nProvider initialLocale="en">
      <PlayerStateContext.Provider value={playerState}>
        <PlayerProgressContext.Provider value={{ currentTime, duration: 120 }}>
          <PlayerActionsContext.Provider value={playerActions}>
            <div className="parent-progress">
              <QueueTab />
            </div>
          </PlayerActionsContext.Provider>
        </PlayerProgressContext.Provider>
      </PlayerStateContext.Provider>
    </I18nProvider>
  );
}

describe("QueueTab rendering", () => {
  it("does not rebuild queue rows when only playback progress changes", () => {
    const { rerender } = render(queueTree(12));
    expect(queueRowRender).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".overflow-y-auto")).toHaveClass(
      "overscroll-contain",
    );

    queueRowRender.mockClear();
    rerender(queueTree(12.25));

    expect(queueRowRender).not.toHaveBeenCalled();
  });
});
