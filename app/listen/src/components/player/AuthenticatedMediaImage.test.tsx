import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mediaVersion, ensureMediaAccessUrlMock } = vi.hoisted(() => ({
  mediaVersion: { value: 1 },
  ensureMediaAccessUrlMock: vi.fn(),
}));

vi.mock("@/hooks/use-media-access-version", () => ({
  useMediaAccessVersion: () => mediaVersion.value,
}));

vi.mock("@/lib/api", () => ({
  ensureMediaAccessUrl: ensureMediaAccessUrlMock,
  resolveMaybeApiAssetUrl: (url: string | null | undefined) =>
    url ? `${url}?ticket-version=${mediaVersion.value}` : null,
}));

import { AuthenticatedMediaImage } from "./AuthenticatedMediaImage";

describe("AuthenticatedMediaImage", () => {
  beforeEach(() => {
    mediaVersion.value = 1;
    ensureMediaAccessUrlMock.mockReset();
    ensureMediaAccessUrlMock.mockResolvedValue(
      "/api/albums/1/cover?media_ticket=renewed",
    );
  });

  it("re-resolves the source when media tickets change", () => {
    const { rerender } = render(
      <AuthenticatedMediaImage src="/api/albums/1/cover" alt="Cover" />,
    );
    expect(screen.getByRole("img", { name: "Cover" })).toHaveAttribute(
      "src",
      "/api/albums/1/cover?ticket-version=1",
    );

    mediaVersion.value = 2;
    rerender(<AuthenticatedMediaImage src="/api/albums/1/cover" alt="Cover" />);

    expect(screen.getByRole("img", { name: "Cover" })).toHaveAttribute(
      "src",
      "/api/albums/1/cover?ticket-version=2",
    );
  });

  it("renews a failed protected image once", async () => {
    render(<AuthenticatedMediaImage src="/api/albums/1/cover" alt="Cover" />);

    fireEvent.error(screen.getByRole("img", { name: "Cover" }));

    await waitFor(() =>
      expect(ensureMediaAccessUrlMock).toHaveBeenCalledWith(
        "/api/albums/1/cover",
        "artwork",
        { forceRefresh: true },
      ),
    );
    expect(screen.getByRole("img", { name: "Cover" })).toHaveAttribute(
      "src",
      "/api/albums/1/cover?media_ticket=renewed",
    );

    fireEvent.error(screen.getByRole("img", { name: "Cover" }));
    expect(ensureMediaAccessUrlMock).toHaveBeenCalledTimes(1);
  });
});
