import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ShareSheetHost } from "@/components/share/ShareSheet";
import { openShareSheet } from "@/lib/social-share";
import { openExternalUrl } from "@/lib/external-links";

vi.mock("@/lib/capacitor-runtime", () => ({
  isNative: false,
}));

vi.mock("@/lib/external-links", () => ({
  openExternalUrl: vi.fn(),
}));

describe("ShareSheetHost", () => {
  it("opens Crate's share sheet instead of the native share dialog", async () => {
    const user = userEvent.setup();
    render(<ShareSheetHost />);

    openShareSheet({
      kind: "album",
      title: "Jane Doe",
      subtitle: "Converge",
      url: "https://listen.example/share/album/1/jane-doe",
    });

    expect(await screen.findByText("Share album")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("Telegram")).toBeInTheDocument();
    expect(screen.queryByText("Instagram Story")).not.toBeInTheDocument();

    await user.click(screen.getByText("Telegram"));
    expect(openExternalUrl).toHaveBeenCalledWith(
      expect.stringContaining("https://t.me/share/url"),
    );
  });
});
