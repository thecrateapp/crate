import { act, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, clipboardWriteTextMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  clipboardWriteTextMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

import { AccessTokensSection } from "@/components/settings/AccessTokensSection";
import { SettingsPanelActivity } from "@/components/settings/settings-panel-activity";
import { SERVER_STORE_EVENT } from "@/lib/server-store";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const SECRET = "crv_one-time-secret";

const EXISTING_TOKEN = {
  id: 7,
  name: "Studio laptop",
  token_type: "personal",
  token_prefix: "crv_abcd1234",
  scopes: ["vdj.catalog.read", "vdj.media.read"],
  expires_at: null,
  revoked_at: null,
  created_at: "2026-10-01T10:00:00Z",
  last_used_at: null,
};

function renderSection() {
  return renderWithListenProviders(<AccessTokensSection />, { locale: "en" });
}

function setupUser() {
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboardWriteTextMock },
  });
  return user;
}

describe("AccessTokensSection", () => {
  let clipboardDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    apiMock.mockReset();
    clipboardWriteTextMock.mockReset();
    clipboardDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteTextMock },
    });
  });

  afterEach(() => {
    if (clipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("lists active tokens with their scopes and usage", async () => {
    apiMock.mockResolvedValueOnce([
      EXISTING_TOKEN,
      {
        ...EXISTING_TOKEN,
        id: 8,
        name: "Old",
        revoked_at: "2026-10-02T00:00:00Z",
      },
    ]);

    renderSection();

    expect(await screen.findByText("Studio laptop")).toBeInTheDocument();
    expect(screen.queryByText("Old")).not.toBeInTheDocument();
    expect(screen.getByText("crv_abcd1234")).toBeInTheDocument();
    expect(
      screen.getByText("Browse and search your library"),
    ).toBeInTheDocument();
    expect(screen.getByText("Never used")).toBeInTheDocument();
    expect(screen.getByText(/VirtualDJ Pro license/)).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/api/auth/access-tokens");
  });

  it("creates a VirtualDJ token and shows the secret only once", async () => {
    const user = setupUser();
    apiMock.mockResolvedValueOnce([]);
    apiMock.mockResolvedValueOnce({
      ...EXISTING_TOKEN,
      id: 9,
      name: "Booth",
      scopes: [
        "vdj.catalog.read",
        "vdj.media.read",
        "vdj.smart_mix.read",
        "vdj.play_events.write",
      ],
      token: SECRET,
    });
    clipboardWriteTextMock.mockResolvedValueOnce(undefined);

    renderSection();
    await user.click(await screen.findByRole("button", { name: "New token" }));
    await user.type(screen.getByLabelText("Token name"), "Booth");
    await user.click(screen.getByRole("button", { name: "90 days" }));
    await user.click(screen.getByRole("button", { name: "Create token" }));

    expect(apiMock).toHaveBeenLastCalledWith(
      "/api/auth/access-tokens",
      "POST",
      {
        name: "Booth",
        scopes: [
          "vdj.catalog.read",
          "vdj.media.read",
          "vdj.smart_mix.read",
          "vdj.play_events.write",
        ],
        expires_in_days: 90,
      },
    );
    expect(await screen.findByText(SECRET)).toBeInTheDocument();
    expect(JSON.stringify(localStorage)).not.toContain(SECRET);
    expect(JSON.stringify(sessionStorage)).not.toContain(SECRET);
    expect(clipboardWriteTextMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Copy token" }));

    expect(clipboardWriteTextMock).toHaveBeenCalledWith(SECRET);
    await waitFor(() =>
      expect(screen.queryByText(SECRET)).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Booth")).toBeInTheDocument();
  });

  it("adds Crate Automix only when the user opts in", async () => {
    const user = setupUser();
    apiMock.mockResolvedValueOnce([]);
    apiMock.mockResolvedValueOnce({ ...EXISTING_TOKEN, id: 10, token: SECRET });

    renderSection();
    await user.click(await screen.findByRole("button", { name: "New token" }));
    await user.type(screen.getByLabelText("Token name"), "Automix");
    const automix = screen.getByRole("switch", {
      name: "Let Crate Automix queue tracks",
    });
    expect(automix).not.toBeChecked();
    await user.click(automix);
    await user.click(screen.getByRole("button", { name: "Create token" }));

    expect(apiMock).toHaveBeenLastCalledWith(
      "/api/auth/access-tokens",
      "POST",
      expect.objectContaining({
        scopes: [
          "vdj.catalog.read",
          "vdj.media.read",
          "vdj.smart_mix.read",
          "vdj.play_events.write",
          "vdj.automation.execute",
        ],
      }),
    );
  });

  it("requires a name and at least one permission before creating", async () => {
    const user = setupUser();
    apiMock.mockResolvedValueOnce([]);

    renderSection();
    await user.click(await screen.findByRole("button", { name: "New token" }));

    expect(screen.getByRole("button", { name: "Create token" })).toBeDisabled();
    await user.type(screen.getByLabelText("Token name"), "Booth");
    for (const label of [
      "Browse and search your library",
      "Play and load tracks",
      "Smart Mix profiles and compatible tracks",
      "Report what you play",
    ]) {
      await user.click(screen.getByRole("switch", { name: label }));
    }

    expect(screen.getByRole("button", { name: "Create token" })).toBeDisabled();
  });

  it("rotates a token after confirmation and shows the new secret", async () => {
    const user = setupUser();
    apiMock.mockResolvedValueOnce([EXISTING_TOKEN]);
    apiMock.mockResolvedValueOnce({ ...EXISTING_TOKEN, id: 10, token: SECRET });

    renderSection();
    await user.click(
      await screen.findByRole("button", { name: "Rotate Studio laptop" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Rotate token" }),
    );

    expect(apiMock).toHaveBeenLastCalledWith(
      "/api/auth/access-tokens/7/rotate",
      "POST",
    );
    expect(await screen.findByText(SECRET)).toBeInTheDocument();
  });

  it("revokes a token after confirmation", async () => {
    const user = setupUser();
    apiMock.mockResolvedValueOnce([EXISTING_TOKEN]);
    apiMock.mockResolvedValueOnce(undefined);

    renderSection();
    await user.click(
      await screen.findByRole("button", { name: "Revoke Studio laptop" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Revoke token" }),
    );

    expect(apiMock).toHaveBeenLastCalledWith(
      "/api/auth/access-tokens/7",
      "DELETE",
    );
    await waitFor(() =>
      expect(screen.queryByText("Studio laptop")).not.toBeInTheDocument(),
    );
  });

  it("explains a failed revocation and keeps the token listed", async () => {
    const user = setupUser();
    apiMock.mockResolvedValueOnce([EXISTING_TOKEN]);
    apiMock.mockRejectedValueOnce(new Error("network"));

    renderSection();
    await user.click(
      await screen.findByRole("button", { name: "Revoke Studio laptop" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Revoke token" }),
    );

    expect(
      await screen.findByText("The token could not be revoked. Try again."),
    ).toBeInTheDocument();
    expect(screen.getByText("Studio laptop")).toBeInTheDocument();
  });

  it("forgets a shown secret when the active server changes", async () => {
    const user = setupUser();
    apiMock.mockResolvedValueOnce([EXISTING_TOKEN]);
    apiMock.mockResolvedValueOnce({ ...EXISTING_TOKEN, id: 10, token: SECRET });
    apiMock.mockResolvedValue([]);

    renderSection();
    await user.click(
      await screen.findByRole("button", { name: "Rotate Studio laptop" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Rotate token" }),
    );
    expect(await screen.findByText(SECRET)).toBeInTheDocument();

    window.dispatchEvent(new Event(SERVER_STORE_EVENT));

    await waitFor(() =>
      expect(screen.queryByText(SECRET)).not.toBeInTheDocument(),
    );
  });

  it.each(["rotate", "revoke"] as const)(
    "dismisses an unsubmitted %s confirmation when Connections hides and does not restore it on return",
    async (kind) => {
      const user = setupUser();
      apiMock.mockResolvedValueOnce([EXISTING_TOKEN]);
      let setActive!: (active: boolean) => void;
      function SettingsPanel() {
        const [active, updateActive] = useState(true);
        setActive = updateActive;
        return (
          <SettingsPanelActivity value={active}>
            <AccessTokensSection />
          </SettingsPanelActivity>
        );
      }
      renderWithListenProviders(<SettingsPanel />, { locale: "en" });
      await user.click(
        await screen.findByRole("button", {
          name: `${kind === "rotate" ? "Rotate" : "Revoke"} Studio laptop`,
        }),
      );
      expect(screen.getByRole("alertdialog")).toBeVisible();
      act(() => setActive(false));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      act(() => setActive(true));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(apiMock.mock.calls).toEqual([["/api/auth/access-tokens"]]);
    },
  );
});
