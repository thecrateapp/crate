import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useReducer, useRef } from "react";
import { MemoryRouter } from "react-router";

import { useJamWebSocket } from "@/hooks/use-jam-websocket";
import { initialJamSessionState, jamSessionReducer } from "@/pages/jam-reducer";

function wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("useJamWebSocket", () => {
  it("does not crash when roomId is undefined", () => {
    const { result } = renderHook(
      () => {
        const [, dispatch] = useReducer(
          jamSessionReducer,
          initialJamSessionState,
        );
        const playerActionsRef = useRef({
          play: vi.fn(),
          playAll: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          seek: vi.fn(),
          currentTrack: undefined,
        });
        const currentTimeRef = useRef(0);
        const roomNameRef = useRef("Jam");
        return useJamWebSocket({
          roomId: undefined,
          userId: undefined,
          dispatch,
          playerActionsRef,
          currentTimeRef,
          roomNameRef,
        });
      },
      { wrapper },
    );
    expect(result.current.sendEvent).toBeDefined();
    expect(result.current.sendEvent({ type: "ping" })).toBe(false);
  });
});
