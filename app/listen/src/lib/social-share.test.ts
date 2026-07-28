import { describe, expect, it, vi } from "vitest";

import {
  buildShareText,
  buildTelegramShareUrl,
  buildWhatsAppShareUrl,
  canvasToJpegBlob,
  openShareSheet,
  SHARE_REQUEST_EVENT,
  type SharePayload,
} from "@/lib/social-share";

const payload: SharePayload = {
  kind: "track",
  title: "Los Monos",
  subtitle: "La Polla Records",
  url: "https://listen.example/share/track/1/los-monos",
};

describe("social-share", () => {
  it("builds concise share text", () => {
    expect(buildShareText(payload)).toBe("Los Monos - La Polla Records");
    expect(buildShareText({ ...payload, subtitle: "Los Monos" })).toBe(
      "Los Monos",
    );
  });

  it("builds WhatsApp share URLs with text and link", () => {
    const url = buildWhatsAppShareUrl(payload);
    expect(url).toContain("https://wa.me/?text=");
    expect(decodeURIComponent(url.split("text=")[1] || "")).toBe(
      "Los Monos - La Polla Records\nhttps://listen.example/share/track/1/los-monos",
    );
  });

  it("builds Telegram share URLs", () => {
    const url = new URL(buildTelegramShareUrl(payload));
    expect(url.origin).toBe("https://t.me");
    expect(url.pathname).toBe("/share/url");
    expect(url.searchParams.get("url")).toBe(payload.url);
    expect(url.searchParams.get("text")).toBe("Los Monos - La Polla Records");
  });

  it("dispatches a share request event", () => {
    const listener = vi.fn();
    window.addEventListener(SHARE_REQUEST_EVENT, listener);
    expect(openShareSheet(payload)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(
      (listener.mock.calls[0]?.[0] as CustomEvent<SharePayload>).detail,
    ).toEqual(payload);
    window.removeEventListener(SHARE_REQUEST_EVENT, listener);
  });

  it("encodes story cards asynchronously without using toDataURL", async () => {
    const blob = new Blob(["jpeg"], { type: "image/jpeg" });
    const toDataURL = vi.fn();
    const toBlob = vi.fn((callback: BlobCallback) => callback(blob));
    const canvas = { toBlob, toDataURL } as unknown as HTMLCanvasElement;

    await expect(canvasToJpegBlob(canvas)).resolves.toBe(blob);
    expect(toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/jpeg",
      0.94,
    );
    expect(toDataURL).not.toHaveBeenCalled();
  });

  it("rejects when asynchronous story-card encoding fails", async () => {
    const canvas = {
      toBlob: (callback: BlobCallback) => callback(null),
    } as HTMLCanvasElement;

    await expect(canvasToJpegBlob(canvas)).rejects.toThrow(
      "Story card encoding failed",
    );
  });
});
