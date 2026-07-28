import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthenticatedApp } from "@/app-shell/AuthenticatedApp";
import {
  clearMediaAccessTickets,
  setMediaAccessTickets,
} from "@/lib/media-access";

const shellRender = vi.hoisted(() => vi.fn());

vi.mock("@/app-shell/AppProviders", () => ({
  AppProviders: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/layout/Shell", () => ({
  Shell: () => {
    shellRender();
    return <div>Shell</div>;
  },
}));

vi.mock("@/components/share/ShareSheet", () => ({
  ShareSheetHost: () => null,
}));

vi.mock("@/components/dev/TauriDevLogPanel", () => ({
  TauriDevLogPanel: () => null,
}));

describe("AuthenticatedApp", () => {
  beforeEach(() => {
    clearMediaAccessTickets();
    shellRender.mockClear();
  });

  it("rebuilds protected media URLs after ticket refresh", () => {
    render(<AuthenticatedApp />);
    expect(shellRender).toHaveBeenCalledTimes(1);

    act(() => {
      setMediaAccessTickets([], "server-a");
    });

    expect(shellRender).toHaveBeenCalledTimes(2);
  });
});
