import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, clipboardWriteTextMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  clipboardWriteTextMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

import { OpenSubsonicCredentialsSection } from "@/components/settings/OpenSubsonicCredentialsSection";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const OPEN_SUBSONIC_KEY = "opensubsonic-one-time-secret";

function renderSection() {
  return renderWithListenProviders(<OpenSubsonicCredentialsSection />, {
    locale: "en",
  });
}

function setupUser() {
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboardWriteTextMock },
  });
  return user;
}

function mockConfiguredStatus(configured: boolean) {
  apiMock.mockResolvedValueOnce({ configured });
}

describe("OpenSubsonicCredentialsSection", () => {
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

  it("shows an accessible loading state before the status request resolves", async () => {
    let resolveStatus!: (value: { configured: boolean }) => void;
    apiMock.mockReturnValueOnce(
      new Promise<{ configured: boolean }>((resolve) => {
        resolveStatus = resolve;
      }),
    );

    renderSection();

    expect(screen.getByRole("status")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /create.*key/i }),
    ).not.toBeInTheDocument();

    resolveStatus({ configured: false });

    expect(
      await screen.findByRole("button", { name: /create.*key/i }),
    ).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the unconfigured state and never displays a secret before creation", async () => {
    mockConfiguredStatus(false);

    renderSection();

    expect(
      await screen.findByRole("button", { name: /create.*key/i }),
    ).toBeVisible();
    expect(screen.queryByText(OPEN_SUBSONIC_KEY)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /rotate.*key/i }),
    ).not.toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/api/auth/subsonic-token");
  });

  it("shows configured status without exposing the existing secret and explains both auth modes", async () => {
    mockConfiguredStatus(true);

    renderSection();

    expect(
      await screen.findByRole("button", { name: /rotate.*key/i }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /revoke.*key/i })).toBeVisible();
    expect(screen.queryByText(OPEN_SUBSONIC_KEY)).not.toBeInTheDocument();
    expect(screen.getByText(/apiKey/i)).toBeVisible();
    expect(
      screen.getByText(
        /legacy.*email or username.*OpenSubsonic key.*password/i,
      ),
    ).toBeVisible();
    expect(screen.getByText(/never.*normal login password/i)).toBeVisible();
  });

  it("creates an initial dedicated key and reveals it only after creation", async () => {
    const user = setupUser();
    mockConfiguredStatus(false);
    apiMock.mockResolvedValueOnce({ api_key: OPEN_SUBSONIC_KEY });

    renderSection();

    const createButton = await screen.findByRole("button", {
      name: /create.*key/i,
    });
    expect(screen.queryByText(OPEN_SUBSONIC_KEY)).not.toBeInTheDocument();

    await user.click(createButton);

    expect(apiMock).toHaveBeenLastCalledWith(
      "/api/auth/subsonic-token",
      "POST",
    );
    expect(await screen.findByText(OPEN_SUBSONIC_KEY)).toBeVisible();
    expect(screen.getByRole("button", { name: /copy.*key/i })).toBeVisible();
  });

  it("clears a successfully copied key and says it will not be shown again", async () => {
    const user = setupUser();
    clipboardWriteTextMock.mockResolvedValue(undefined);
    mockConfiguredStatus(false);
    apiMock.mockResolvedValueOnce({ api_key: OPEN_SUBSONIC_KEY });

    renderSection();
    await user.click(
      await screen.findByRole("button", { name: /create.*key/i }),
    );
    await screen.findByText(OPEN_SUBSONIC_KEY);

    await user.click(screen.getByRole("button", { name: /copy.*key/i }));

    expect(clipboardWriteTextMock).toHaveBeenCalledWith(OPEN_SUBSONIC_KEY);
    expect(screen.queryByText(OPEN_SUBSONIC_KEY)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /copy.*key/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      /will not be shown again/i,
    );
  });

  it("does not rotate until the user confirms, then reveals the replacement key", async () => {
    const user = setupUser();
    mockConfiguredStatus(true);
    apiMock.mockResolvedValueOnce({ api_key: OPEN_SUBSONIC_KEY });

    renderSection();
    await user.click(
      await screen.findByRole("button", { name: /rotate.*key/i }),
    );

    const confirmation = screen.getByRole("alertdialog");
    expect(confirmation).toBeVisible();
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).not.toHaveBeenCalledWith(
      "/api/auth/subsonic-token",
      "POST",
    );

    await user.click(
      within(confirmation).getByRole("button", { name: /confirm.*rotat/i }),
    );

    expect(apiMock).toHaveBeenLastCalledWith(
      "/api/auth/subsonic-token",
      "POST",
    );
    expect(await screen.findByText(OPEN_SUBSONIC_KEY)).toBeVisible();
  });

  it("keeps the existing key when rotation is cancelled", async () => {
    const user = setupUser();
    mockConfiguredStatus(true);

    renderSection();
    await user.click(
      await screen.findByRole("button", { name: /rotate.*key/i }),
    );

    const confirmation = screen.getByRole("alertdialog");
    await user.click(
      within(confirmation).getByRole("button", { name: /cancel/i }),
    );

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).not.toHaveBeenCalledWith(
      "/api/auth/subsonic-token",
      "POST",
    );
    expect(screen.getByRole("button", { name: /rotate.*key/i })).toBeVisible();
  });

  it("does not revoke until confirmation and lets the user cancel safely", async () => {
    const user = setupUser();
    mockConfiguredStatus(true);

    renderSection();
    await user.click(
      await screen.findByRole("button", { name: /revoke.*key/i }),
    );

    const confirmation = screen.getByRole("alertdialog");
    expect(confirmation).toBeVisible();
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).not.toHaveBeenCalledWith(
      "/api/auth/subsonic-token",
      "DELETE",
    );

    await user.click(
      within(confirmation).getByRole("button", { name: /cancel/i }),
    );

    expect(apiMock).not.toHaveBeenCalledWith(
      "/api/auth/subsonic-token",
      "DELETE",
    );
    expect(screen.getByRole("button", { name: /revoke.*key/i })).toBeVisible();
  });

  it("revokes the key only after confirmation and returns to the unconfigured state", async () => {
    const user = setupUser();
    mockConfiguredStatus(true);
    apiMock.mockResolvedValueOnce({ ok: true });

    renderSection();
    await user.click(
      await screen.findByRole("button", { name: /revoke.*key/i }),
    );

    const confirmation = screen.getByRole("alertdialog");
    expect(apiMock).not.toHaveBeenCalledWith(
      "/api/auth/subsonic-token",
      "DELETE",
    );

    await user.click(
      within(confirmation).getByRole("button", { name: /confirm.*revoc/i }),
    );

    expect(apiMock).toHaveBeenLastCalledWith(
      "/api/auth/subsonic-token",
      "DELETE",
    );
    expect(
      await screen.findByRole("button", { name: /create.*key/i }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /rotate.*key/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /revoke.*key/i }),
    ).not.toBeInTheDocument();
  });

  it("announces status API errors accessibly", async () => {
    apiMock.mockRejectedValueOnce(
      new Error("Unable to load credential status"),
    );

    renderSection();

    expect(await screen.findByRole("alert")).toBeVisible();
  });

  it("announces key creation API errors accessibly", async () => {
    const user = setupUser();
    mockConfiguredStatus(false);
    apiMock.mockRejectedValueOnce(new Error("Credential request failed"));

    renderSection();
    await user.click(
      await screen.findByRole("button", { name: /create.*key/i }),
    );

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByText(OPEN_SUBSONIC_KEY)).not.toBeInTheDocument();
  });

  it.each([
    {
      label: "rotation",
      trigger: /rotate.*key/i,
      confirmation: /confirm.*rotat/i,
    },
    {
      label: "revocation",
      trigger: /revoke.*key/i,
      confirmation: /confirm.*revoc/i,
    },
  ])(
    "preserves a visible key when $label fails",
    async ({ trigger, confirmation: confirmLabel }) => {
      const user = setupUser();
      mockConfiguredStatus(false);
      apiMock.mockResolvedValueOnce({ api_key: OPEN_SUBSONIC_KEY });
      apiMock.mockRejectedValueOnce(new Error("Credential update failed"));

      renderSection();
      await user.click(
        await screen.findByRole("button", { name: /create.*key/i }),
      );
      expect(await screen.findByText(OPEN_SUBSONIC_KEY)).toBeVisible();

      await user.click(await screen.findByRole("button", { name: trigger }));
      const confirmation = screen.getByRole("alertdialog");
      await user.click(
        within(confirmation).getByRole("button", { name: confirmLabel }),
      );

      expect(await screen.findByRole("alert")).toBeVisible();
      expect(screen.getByText(OPEN_SUBSONIC_KEY)).toBeVisible();
    },
  );

  it("announces clipboard errors accessibly and keeps the key available to retry", async () => {
    const user = setupUser();
    clipboardWriteTextMock.mockRejectedValue(
      new Error("Clipboard unavailable"),
    );
    mockConfiguredStatus(false);
    apiMock.mockResolvedValueOnce({ api_key: OPEN_SUBSONIC_KEY });

    renderSection();
    await user.click(
      await screen.findByRole("button", { name: /create.*key/i }),
    );
    await screen.findByText(OPEN_SUBSONIC_KEY);

    await user.click(screen.getByRole("button", { name: /copy.*key/i }));

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByText(OPEN_SUBSONIC_KEY)).toBeVisible();
  });
});
