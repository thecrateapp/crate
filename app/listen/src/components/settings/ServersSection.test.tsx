import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentServerIdMock,
  getServersMock,
  logoutMock,
  removeServerMock,
  revokeServerSessionMock,
  setCurrentServerIdMock,
} = vi.hoisted(() => ({
  getCurrentServerIdMock: vi.fn<() => string | null>(),
  getServersMock: vi.fn<() => unknown[]>(),
  logoutMock: vi.fn(() => Promise.resolve()),
  removeServerMock: vi.fn(),
  revokeServerSessionMock: vi.fn(() => Promise.resolve()),
  setCurrentServerIdMock: vi.fn(),
}));

vi.mock("@/lib/platform", () => ({ usesConfigurableServer: true }));
vi.mock("@/lib/server-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server-store")>()),
  SERVER_STORE_EVENT: "crate-server-store-change",
  getCurrentServerId: getCurrentServerIdMock,
  getServers: getServersMock,
  removeServer: removeServerMock,
  setCurrentServerId: setCurrentServerIdMock,
}));
vi.mock("@/lib/api", () => ({
  revokeServerSession: revokeServerSessionMock,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ logout: logoutMock }),
}));

import { I18nProvider } from "@/i18n";

import { ServersSection } from "./ServersSection";

describe("ServersSection", () => {
  const serverA = {
    id: "server-a",
    label: "Server A",
    url: "https://a.example.test",
    token: "token-a",
    tokenExpiresAt: null,
    refreshToken: "refresh-a",
  };
  const serverB = {
    id: "server-b",
    label: "Server B",
    url: "https://b.example.test",
    token: "token-b",
    tokenExpiresAt: null,
    refreshToken: "refresh-b",
  };

  beforeEach(() => {
    getCurrentServerIdMock.mockReset().mockReturnValue(serverA.id);
    getServersMock.mockReset().mockReturnValue([serverA, serverB]);
    logoutMock.mockReset().mockResolvedValue(undefined);
    removeServerMock.mockReset();
    revokeServerSessionMock.mockReset().mockResolvedValue(undefined);
    setCurrentServerIdMock.mockReset();
  });

  it("revokes the removed server snapshot without logging out the fallback", async () => {
    render(
      <MemoryRouter>
        <I18nProvider initialLocale="en">
          <ServersSection />
        </I18nProvider>
      </MemoryRouter>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Remove Server A" }),
    );

    expect(revokeServerSessionMock).toHaveBeenCalledWith(serverA);
    expect(removeServerMock).toHaveBeenCalledWith(serverA.id);
    expect(revokeServerSessionMock.mock.invocationCallOrder[0]).toBeLessThan(
      removeServerMock.mock.invocationCallOrder[0]!,
    );
    expect(logoutMock).not.toHaveBeenCalled();
  });

  it("removes a server locally when remote revocation cannot complete", async () => {
    revokeServerSessionMock.mockRejectedValueOnce(new Error("offline"));
    render(
      <MemoryRouter>
        <I18nProvider initialLocale="en">
          <ServersSection />
        </I18nProvider>
      </MemoryRouter>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Remove Server A" }),
    );

    expect(removeServerMock).toHaveBeenCalledWith(serverA.id);
    expect(logoutMock).not.toHaveBeenCalled();
  });
});
