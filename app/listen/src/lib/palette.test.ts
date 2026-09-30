import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  ensureMediaAccessUrl: vi.fn(async (url: string) => `${url}?access=valid`),
  requiresMediaAccessTicket: vi.fn((url: string) =>
    url.includes("/api/artwork/"),
  ),
  resolveMaybeApiAssetUrl: vi.fn((url: string) =>
    url.startsWith("/api/") ? `https://api.example.test${url}` : null,
  ),
}));

vi.mock("@/lib/api", () => apiMocks);

import { extractPalette } from "./palette";

describe("extractPalette", () => {
  const context = {
    drawImage: vi.fn(),
    getImageData: vi.fn(),
  };
  const pixels = new Uint8ClampedArray(64 * 64 * 4);
  const createObjectURL = vi.fn(() => "blob:palette-artwork");
  const revokeObjectURL = vi.fn();

  class TestImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_url: string) {
      this.onload?.();
    }
  }

  beforeEach(() => {
    apiMocks.ensureMediaAccessUrl.mockClear();
    apiMocks.requiresMediaAccessTicket.mockClear();
    apiMocks.resolveMaybeApiAssetUrl.mockClear();
    context.drawImage.mockClear();
    context.getImageData.mockReset();
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = 50;
      pixels[index + 1] = 150;
      pixels[index + 2] = 210;
      pixels[index + 3] = 255;
    }
    context.getImageData.mockReturnValue({ data: pixels });
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob(["artwork"]),
      })),
    );
    vi.stubGlobal("Image", TestImage);
    vi.spyOn(URL, "createObjectURL").mockImplementation(createObjectURL);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeObjectURL);

    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((
      tagName: string,
    ) => {
      if (tagName === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => context,
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    }) as typeof document.createElement);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fetches ticketed API artwork as a blob before sampling it", async () => {
    const palette = await extractPalette("/api/artwork/42.jpg");

    expect(apiMocks.resolveMaybeApiAssetUrl).toHaveBeenCalledWith(
      "/api/artwork/42.jpg",
    );
    expect(apiMocks.ensureMediaAccessUrl).toHaveBeenCalledWith(
      "https://api.example.test/api/artwork/42.jpg",
      "artwork",
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.test/api/artwork/42.jpg?access=valid",
    );
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(context.drawImage).toHaveBeenCalledWith(
      expect.any(TestImage),
      0,
      0,
      64,
      64,
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:palette-artwork");
    expect(palette).toHaveLength(3);
  });
});
