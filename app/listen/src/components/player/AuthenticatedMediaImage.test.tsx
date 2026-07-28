import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mediaVersion,
  mediaResumeVersion,
  ensureMediaAccessUrlMock,
  resolveMaybeApiAssetUrlMock,
} = vi.hoisted(() => {
  const mediaVersionState = { value: 1 };
  return {
    mediaVersion: mediaVersionState,
    mediaResumeVersion: { value: 0 },
    ensureMediaAccessUrlMock: vi.fn(),
    resolveMaybeApiAssetUrlMock: vi.fn((url: string | null | undefined) =>
      url ? `${url}?ticket-version=${mediaVersionState.value}` : null,
    ),
  };
});

vi.mock("@/hooks/use-media-access-version", () => ({
  useMediaAccessVersion: () => mediaVersion.value,
  useMediaAccessResumeVersion: () => mediaResumeVersion.value,
}));

vi.mock("@/lib/api", () => ({
  ensureMediaAccessUrl: ensureMediaAccessUrlMock,
  isUsableMediaAssetUrl: (url: string | null | undefined) =>
    Boolean(url?.includes("ticket-version") || url?.includes("media_ticket")),
  requiresMediaAccessTicket: (url: string | null | undefined) =>
    Boolean(url?.startsWith("/api/")),
  resolveMaybeApiAssetUrl: resolveMaybeApiAssetUrlMock,
}));

import { AuthenticatedMediaImage } from "./AuthenticatedMediaImage";

describe("AuthenticatedMediaImage", () => {
  beforeEach(() => {
    mediaVersion.value = 1;
    mediaResumeVersion.value = 0;
    ensureMediaAccessUrlMock.mockReset();
    resolveMaybeApiAssetUrlMock.mockClear();
    ensureMediaAccessUrlMock.mockResolvedValue(
      "/api/albums/1/cover?media_ticket=renewed",
    );
  });

  it("keeps a loaded source stable when media tickets rotate", () => {
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
      "/api/albums/1/cover?ticket-version=1",
    );
  });

  it("proactively replaces an expired source after the app resumes", async () => {
    const { rerender } = render(
      <AuthenticatedMediaImage src="/api/albums/1/cover" alt="Cover" />,
    );
    const image = screen.getByRole("img", { name: "Cover" });
    fireEvent.load(image);

    mediaResumeVersion.value = 1;
    rerender(<AuthenticatedMediaImage src="/api/albums/1/cover" alt="Cover" />);

    await waitFor(() =>
      expect(ensureMediaAccessUrlMock).toHaveBeenCalledWith(
        "/api/albums/1/cover",
        "artwork",
        { forceRefresh: true },
      ),
    );
    expect(image).toHaveAttribute(
      "src",
      "/api/albums/1/cover?media_ticket=renewed",
    );
  });

  it("re-registers the protected path during the resume render for batching", async () => {
    const { rerender } = render(
      <AuthenticatedMediaImage src="/api/albums/1/cover" alt="Cover" />,
    );
    expect(resolveMaybeApiAssetUrlMock).toHaveBeenCalledTimes(1);

    mediaResumeVersion.value = 1;
    rerender(<AuthenticatedMediaImage src="/api/albums/1/cover" alt="Cover" />);

    expect(resolveMaybeApiAssetUrlMock).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(ensureMediaAccessUrlMock).toHaveBeenCalledTimes(1),
    );
  });

  it("keeps a loaded source stable when bearer credentials rotate", () => {
    const { rerender } = render(
      <AuthenticatedMediaImage
        src="/api/albums/1/cover?token=old"
        alt="Cover"
      />,
    );
    expect(screen.getByRole("img", { name: "Cover" })).toHaveAttribute(
      "src",
      "/api/albums/1/cover?token=old?ticket-version=1",
    );

    mediaVersion.value = 2;
    rerender(
      <AuthenticatedMediaImage
        src="/api/albums/1/cover?token=new"
        alt="Cover"
      />,
    );

    expect(screen.getByRole("img", { name: "Cover" })).toHaveAttribute(
      "src",
      "/api/albums/1/cover?token=old?ticket-version=1",
    );
  });

  it("resolves every responsive candidate with the same ticket lifecycle", () => {
    render(
      <AuthenticatedMediaImage
        src="/api/albums/1/cover?size=256"
        srcSet="/api/albums/1/cover?size=160 160w, /api/albums/1/cover?size=320 320w"
        sizes="50vw"
        alt="Cover"
      />,
    );

    expect(screen.getByRole("img", { name: "Cover" })).toHaveAttribute(
      "srcset",
      "/api/albums/1/cover?size=160?ticket-version=1 160w, /api/albums/1/cover?size=320?ticket-version=1 320w",
    );
  });

  it("renews a protected credential again after the replacement loaded", async () => {
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

    fireEvent.load(screen.getByRole("img", { name: "Cover" }));
    fireEvent.error(screen.getByRole("img", { name: "Cover" }));
    await waitFor(() =>
      expect(ensureMediaAccessUrlMock).toHaveBeenCalledTimes(2),
    );
  });

  it("delegates a persistent protected failure after one bounded retry", async () => {
    const onError = vi.fn();
    render(
      <AuthenticatedMediaImage
        src="/api/albums/1/cover"
        alt="Cover"
        onError={onError}
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: "Cover" }));
    await waitFor(() =>
      expect(ensureMediaAccessUrlMock).toHaveBeenCalledTimes(1),
    );
    expect(onError).not.toHaveBeenCalled();

    fireEvent.error(screen.getByRole("img", { name: "Cover" }));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(ensureMediaAccessUrlMock).toHaveBeenCalledTimes(1);
  });
});
