import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildShareImageFileName,
  buildShareText,
  buildTelegramShareUrl,
  buildWhatsAppShareUrl,
  canvasToJpegBlob,
  openShareSheet,
  shareImageFile,
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

  it("uses explicit localized text for chat targets", () => {
    const url = buildWhatsAppShareUrl(payload, "«Los Monos» — Crate de Jane");
    expect(decodeURIComponent(url.split("text=")[1] || "")).toBe(
      "«Los Monos» — Crate de Jane\nhttps://listen.example/share/track/1/los-monos",
    );
    expect(
      new URL(buildTelegramShareUrl(payload, "Hola")).searchParams.get("text"),
    ).toBe("Hola");
  });

  it("builds ASCII image file names", () => {
    expect(
      buildShareImageFileName(
        { ...payload, kind: "crate", title: "Canciones de Año Nuevo!" },
        "story",
      ),
    ).toBe("crate-canciones-de-ano-nuevo-story.jpg");
    expect(buildShareImageFileName({ ...payload, title: "★" }, "square")).toBe(
      "crate-track-post.jpg",
    );
  });
});

describe("shareImageFile", () => {
  const originalShare = navigator.share;
  const originalCanShare = navigator.canShare;

  function setNavigatorShare(
    share: ((data?: ShareData) => Promise<void>) | undefined,
    canShare: ((data?: ShareData) => boolean) | undefined,
  ) {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: canShare,
    });
  }

  afterEach(() => {
    setNavigatorShare(originalShare, originalCanShare);
    vi.restoreAllMocks();
  });

  const blob = new Blob(["jpeg"], { type: "image/jpeg" });

  it("shares files when the browser supports it", async () => {
    const share = vi.fn(async () => undefined);
    setNavigatorShare(share, () => true);

    await expect(
      shareImageFile(blob, "crate-story.jpg", { title: "Crate" }),
    ).resolves.toBe("shared");
    const [data] = share.mock.calls[0] as unknown as [ShareData];
    expect(data.files?.[0]?.name).toBe("crate-story.jpg");
    expect(data.files?.[0]?.type).toBe("image/jpeg");
  });

  it("treats a dismissed share sheet as cancelled", async () => {
    setNavigatorShare(
      vi.fn(async () => {
        throw new DOMException("dismissed", "AbortError");
      }),
      () => true,
    );

    await expect(shareImageFile(blob, "crate-story.jpg")).resolves.toBe(
      "cancelled",
    );
  });

  it("downloads the image when file sharing is unavailable", async () => {
    setNavigatorShare(undefined, undefined);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:story"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const anchors: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      anchors.push(this);
    });

    await expect(shareImageFile(blob, "crate-post.jpg")).resolves.toBe(
      "downloaded",
    );
    expect(anchors[0]?.download).toBe("crate-post.jpg");
    expect(anchors[0]?.href).toBe("blob:story");
  });

  it("falls back to a download when the share call loses user activation", async () => {
    setNavigatorShare(
      vi.fn(async () => {
        throw new DOMException("no activation", "NotAllowedError");
      }),
      () => true,
    );
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:story"),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );

    await expect(shareImageFile(blob, "crate-story.jpg")).resolves.toBe(
      "downloaded",
    );
  });

  it("refuses to download when downloads are not allowed", async () => {
    setNavigatorShare(undefined, undefined);

    await expect(
      shareImageFile(blob, "crate-story.jpg", { allowDownload: false }),
    ).rejects.toThrow();
  });
});
