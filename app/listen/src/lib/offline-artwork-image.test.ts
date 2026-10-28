import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { validateOfflineArtworkImage } from "./offline-artwork-image";
class DecodingImage {
  naturalWidth = 1;
  naturalHeight = 1;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(value: string) {
    if (value === "zero") this.naturalWidth = 0;
    queueMicrotask(() => {
      if (value === "corrupt") this.onerror?.();
      else this.onload?.();
    });
  }
}
beforeEach(() => vi.stubGlobal("Image", DecodingImage));
afterEach(() => vi.unstubAllGlobals());
it("accepts only images the browser actually decodes", async () => {
  await expect(validateOfflineArtworkImage("valid")).resolves.toBeUndefined();
  await expect(validateOfflineArtworkImage("corrupt")).rejects.toThrow(
    "Invalid offline artwork",
  );
  await expect(validateOfflineArtworkImage("zero")).rejects.toThrow(
    "Invalid offline artwork",
  );
});
it("cancels a decode without retaining its image listeners", async () => {
  const controller = new AbortController();
  const result = validateOfflineArtworkImage("valid", controller.signal);
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  await expect(
    validateOfflineArtworkImage("valid", controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});
