import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrateImage } from "./CrateImage";
import { setActiveOfflineProfileKey } from "@/lib/offline-storage";
const reads = vi.hoisted(() => ({
  read: vi.fn(),
  release: vi.fn(),
  discard: vi.fn(),
  apiBase: "",
}));
vi.mock("@/lib/offline-artwork", () => ({
  readOfflineArtwork: reads.read,
  discardOfflineArtwork: reads.discard,
}));
vi.mock("@/hooks/use-media-access-version", () => ({
  useMediaAccessVersion: () => 0,
  useMediaAccessResumeVersion: () => 0,
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiUrl: (path: string) => reads.apiBase + path,
}));
import { notifyOfflineArtworkChanged } from "@/lib/offline-artwork-events";
const originalOnline = Object.getOwnPropertyDescriptor(navigator, "onLine");
beforeEach(() => {
  vi.clearAllMocks();
  reads.apiBase = "";
  reads.read.mockImplementation(async (profile: string) =>
    profile === "profile-a"
      ? { src: "blob:saved-cover", release: reads.release }
      : null,
  );
  setActiveOfflineProfileKey("profile-a");
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
});
afterEach(() => {
  setActiveOfflineProfileKey(null);
  if (originalOnline)
    Object.defineProperty(navigator, "onLine", originalOnline);
  else Reflect.deleteProperty(navigator, "onLine");
});
it("uses the local cover without responsive remote candidates and releases it on unmount", async () => {
  const { unmount } = render(
    <CrateImage
      src="/api/albums/7/cover?media_ticket=old"
      srcSet="/api/albums/7/cover?size=128 128w"
      alt="Saved album"
    />,
  );
  await waitFor(() =>
    expect(screen.getByAltText("Saved album")).toHaveAttribute(
      "src",
      "blob:saved-cover",
    ),
  );
  expect(screen.getByAltText("Saved album")).not.toHaveAttribute("srcset");
  fireEvent.load(screen.getByAltText("Saved album"));
  unmount();
  expect(reads.release).toHaveBeenCalledOnce();
});
it("never keeps another profile's ready cover after an offline identity change", async () => {
  render(<CrateImage src="/api/albums/7/cover" alt="Saved album" />);
  await waitFor(() =>
    expect(screen.getByAltText("Saved album")).toHaveAttribute(
      "src",
      "blob:saved-cover",
    ),
  );
  fireEvent.load(screen.getByAltText("Saved album"));
  act(() => setActiveOfflineProfileKey("profile-b"));
  await waitFor(() =>
    expect(screen.queryByAltText("Saved album")).not.toBeInTheDocument(),
  );
  expect(reads.release).toHaveBeenCalledOnce();
});

it("resolves relative canonical paths against the active API even in a local native webview", async () => {
  reads.apiBase = "https://api.example.test";
  render(<CrateImage src="/api/albums/7/cover" alt="Native offline" />);
  await waitFor(() =>
    expect(screen.getByAltText("Native offline")).toHaveAttribute(
      "src",
      "blob:saved-cover",
    ),
  );
});
it("does not substitute a private local cover for a foreign absolute API URL", () => {
  reads.apiBase = "https://api.example.test";
  render(
    <CrateImage src="https://foreign.test/api/albums/7/cover" alt="Foreign" />,
  );
  expect(reads.read).not.toHaveBeenCalled();
  expect(screen.getByAltText("Foreign")).not.toHaveAttribute(
    "src",
    "blob:saved-cover",
  );
});
it("keeps mounted artwork and its lease stable while an unrelated album changes", async () => {
  render(<CrateImage src="/api/albums/7/cover" alt="Stable" />);
  await waitFor(() =>
    expect(screen.getByAltText("Stable")).toHaveAttribute(
      "src",
      "blob:saved-cover",
    ),
  );
  fireEvent.load(screen.getByAltText("Stable"));
  await act(async () =>
    notifyOfflineArtworkChanged("profile-a", "artwork:album:8"),
  );
  expect(screen.getByAltText("Stable")).toHaveAttribute(
    "src",
    "blob:saved-cover",
  );
  expect(reads.read).toHaveBeenCalledTimes(1);
  expect(reads.release).not.toHaveBeenCalled();
});
it("evicts a corrupt persisted cover and falls back to a healthy remote source online", async () => {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  reads.discard.mockImplementation(
    async (profile: string, ref: { key: string }) => {
      reads.read.mockResolvedValue(null);
      notifyOfflineArtworkChanged(profile, ref.key);
    },
  );
  render(<CrateImage src="/api/albums/7/cover" alt="Recover" />);
  await waitFor(() =>
    expect(screen.getByAltText("Recover")).toHaveAttribute(
      "src",
      "blob:saved-cover",
    ),
  );
  fireEvent.error(screen.getByAltText("Recover"));
  await waitFor(() =>
    expect(screen.getByAltText("Recover")).toHaveAttribute(
      "src",
      "/api/albums/7/cover",
    ),
  );
  expect(reads.discard).toHaveBeenCalledWith("profile-a", {
    key: "artwork:album:7",
    path: "/api/albums/7/cover",
  });
});
