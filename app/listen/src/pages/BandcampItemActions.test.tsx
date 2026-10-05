import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { openExternalUrl } from "@/lib/external-links";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { BandcampItemActions } from "./BandcampItemActions";

vi.mock("@/lib/external-links", () => ({
  openExternalUrl: vi.fn(),
}));

const mockOpenExternalUrl = vi.mocked(openExternalUrl);
const errorToast = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({ toast: { error: errorToast } }));

describe("BandcampItemActions", () => {
  beforeEach(() => {
    mockOpenExternalUrl.mockResolvedValue(undefined);
  });

  afterEach(() => {
    mockOpenExternalUrl.mockReset();
    mockOpenExternalUrl.mockResolvedValue(undefined);
    vi.mocked(toast.error).mockReset();
  });

  it("opens item links through the shared external-link helper", async () => {
    const user = userEvent.setup();

    renderWithListenProviders(
      <BandcampItemActions
        item={{
          id: 1,
          item_url: "https://artist.bandcamp.com/album/release",
        }}
        busyAction={null}
        onImport={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /open/i }));

    expect(mockOpenExternalUrl).toHaveBeenCalledWith(
      "https://artist.bandcamp.com/album/release",
    );
  });

  it("shows feedback when the external opener fails", async () => {
    const user = userEvent.setup();
    mockOpenExternalUrl.mockRejectedValueOnce(new Error("opener failed"));

    renderWithListenProviders(
      <BandcampItemActions
        item={{
          id: 1,
          item_url: "https://artist.bandcamp.com/album/release",
        }}
        busyAction={null}
        onImport={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /open/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not open external link"),
    );
  });
});
