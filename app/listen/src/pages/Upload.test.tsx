import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";

const toastErrorMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());

vi.mock("@crate/ui/lib/notify", () => ({
  notify: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

import { ApiError, api } from "@/lib/api";
import { Upload, uploadMusicFiles } from "@/pages/Upload";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  api: vi.fn(),
}));

describe("uploadMusicFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the existing multipart upload for small batches", async () => {
    vi.mocked(api).mockResolvedValueOnce({
      task_id: "task-1",
      upload_id: "upload-1",
      file_count: 1,
      total_bytes: 3,
    });

    const response = await uploadMusicFiles(
      [new File(["abc"], "track.mp3", { type: "audio/mpeg" })],
      { chunkedThresholdBytes: 10 },
    );

    expect(response.task_id).toBe("task-1");
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith(
      "/api/acquisition/upload",
      "POST",
      expect.any(FormData),
    );
  });

  it("splits large batches into chunked upload requests", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({
        upload_id: "abc123abc123",
        file_count: 1,
        chunk_size: 4,
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        task_id: "task-chunked",
        upload_id: "abc123abc123",
        file_count: 1,
        total_bytes: 7,
      });
    const onProgress = vi.fn();

    const response = await uploadMusicFiles(
      [new File(["abcdefg"], "album.zip", { type: "application/zip" })],
      { chunkedThresholdBytes: 4, onProgress },
    );

    expect(response.task_id).toBe("task-chunked");
    expect(api).toHaveBeenNthCalledWith(
      1,
      "/api/acquisition/upload/chunked",
      "POST",
      {
        files: [{ name: "album.zip", size: 7, type: "application/zip" }],
      },
    );

    const firstChunk = vi.mocked(api).mock.calls[1]?.[2] as FormData;
    expect(firstChunk.get("file_index")).toBe("0");
    expect(firstChunk.get("chunk_index")).toBe("0");

    const secondChunk = vi.mocked(api).mock.calls[2]?.[2] as FormData;
    expect(secondChunk.get("file_index")).toBe("0");
    expect(secondChunk.get("chunk_index")).toBe("1");

    expect(api).toHaveBeenNthCalledWith(
      4,
      "/api/acquisition/upload/chunked/abc123abc123/complete",
      "POST",
    );
    expect(onProgress).toHaveBeenLastCalledWith({ done: 2, total: 2 });
  });
});

describe("Upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens the native picker from a keyboard-reachable canonical action without exposing native file chrome", () => {
    renderWithListenProviders(<Upload />, { locale: "en" });
    const picker = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    expect(picker).toHaveAttribute("data-slot", "input");
    expect(picker).toHaveAttribute("hidden");
    expect(picker).toHaveAttribute("multiple");
    const choose = screen.getByRole("button", { name: "Choose files" });
    expect(choose).toHaveAttribute("data-slot", "button");
    const nativePicker = vi.spyOn(picker, "click");
    fireEvent.click(choose);
    expect(nativePicker).toHaveBeenCalledOnce();
    expect(screen.queryByText("What happens next")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/enrichment run in the background/),
    ).not.toBeInTheDocument();
  });

  it("stages dropped files without issuing a request until import is confirmed", () => {
    renderWithListenProviders(<Upload />, { locale: "en" });
    const zone = screen.getByRole("group", { name: "Upload music" });
    fireEvent.drop(zone, {
      dataTransfer: { files: [new File(["music"], "Evening.flac")] },
    });
    expect(screen.getByText("Evening.flac")).toBeVisible();
    expect(vi.mocked(api)).not.toHaveBeenCalled();
  });

  it("shows an active drop target for files, preserves the queue on text drops and resets after dropping", () => {
    renderWithListenProviders(<Upload />, { locale: "en" });
    const zone = screen.getByRole("group", { name: "Upload music" });
    expect(zone).toHaveAttribute("data-upload-dropzone");
    expect(zone.querySelector("svg.crate-logo")).toHaveAttribute(
      "data-crate-logo-effects",
      "off",
    );
    expect(zone).toHaveClass("border-dashed", "min-h-64");
    fireEvent.dragEnter(zone, { dataTransfer: { types: ["Files"] } });
    expect(zone).toHaveAttribute("data-dragging", "true");
    fireEvent.drop(zone, {
      dataTransfer: { files: [new File(["music"], "Evening.flac")] },
    });
    expect(zone).toHaveAttribute("data-dragging", "false");
    fireEvent.drop(zone, {
      dataTransfer: { files: [], types: ["text/plain"] },
    });
    expect(screen.getByText("Evening.flac")).toBeVisible();
    expect(vi.mocked(api)).not.toHaveBeenCalled();
  });

  it("does not replace files from a drop while an upload is in flight", async () => {
    const request = deferred<unknown>();
    vi.mocked(api).mockImplementationOnce(() => request.promise);
    const { container } = renderWithListenProviders(<Upload />, {
      locale: "en",
    });
    chooseFiles(container, [new File(["music"], "Original.flac")]);
    fireEvent.click(screen.getByRole("button", { name: "Import to library" }));
    fireEvent.drop(screen.getByRole("group", { name: "Upload music" }), {
      dataTransfer: { files: [new File(["new"], "Replacement.flac")] },
    });
    expect(screen.getByText("Original.flac")).toBeVisible();
    expect(screen.queryByText("Replacement.flac")).not.toBeInTheDocument();
    await act(async () =>
      request.resolve({ task_id: "task", file_count: 1, total_bytes: 5 }),
    );
  });

  it("localizes the upload page chrome", () => {
    renderWithListenProviders(<Upload />, { locale: "es" });

    expect(screen.getByText("Subir música")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Añade música a tu biblioteca" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Arrastra archivos aquí o elige archivos"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Importar a la biblioteca" }),
    ).toBeInTheDocument();
  });

  it("localizes upload queue errors", async () => {
    vi.mocked(api).mockRejectedValueOnce(new ApiError(413, "Too large"));
    const { container } = renderWithListenProviders(<Upload />, {
      locale: "es",
    });

    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Upload input missing");
    }

    fireEvent.change(input, {
      target: {
        files: [new File(["abc"], "album.zip", { type: "application/zip" })],
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Importar a la biblioteca" }),
    );

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "La subida es demasiado grande para una sola petición. Inténtalo de nuevo para que Crate pueda dividirla en fragmentos.",
      );
    });
  });

  it("uses the semantic canvas token for the pending upload queue", () => {
    const { container } = renderWithListenProviders(<Upload />, {
      locale: "es",
    });

    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Upload input missing");
    }

    fireEvent.change(input, {
      target: {
        files: [new File(["abc"], "album.zip", { type: "application/zip" })],
      },
    });

    expect(container.querySelector(".bg-surface-canvas")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("gradient-bg-50");
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function chooseFiles(container: HTMLElement, files: File[]) {
  const input = container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement))
    throw new Error("Upload input missing");
  fireEvent.change(input, { target: { files } });
  return input;
}

describe("uploadMusicFiles byte reporting", () => {
  beforeEach(() => vi.mocked(api).mockReset());

  it("reports confirmed bytes per unequal file, including short last chunks, without changing chunk counts", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({
        upload_id: "bytes",
        file_count: 2,
        chunk_size: 4,
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        task_id: "task",
        upload_id: "bytes",
        file_count: 2,
        total_bytes: 10,
      });
    const onFileProgress = vi.fn();
    const onProgress = vi.fn();

    await uploadMusicFiles(
      [new File(["abcdefg"], "large.flac"), new File(["abc"], "small.flac")],
      { chunkedThresholdBytes: 4, onProgress, onFileProgress },
    );

    expect(onFileProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { fileIndex: 0, loadedBytes: 0, totalBytes: 7 },
      { fileIndex: 1, loadedBytes: 0, totalBytes: 3 },
      { fileIndex: 0, loadedBytes: 4, totalBytes: 7 },
      { fileIndex: 0, loadedBytes: 7, totalBytes: 7 },
      { fileIndex: 1, loadedBytes: 3, totalBytes: 3 },
    ]);
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ]);
    expect(
      (vi.mocked(api).mock.calls[2]?.[2] as FormData).get("chunk"),
    ).toHaveProperty("size", 3);
    expect(
      (vi.mocked(api).mock.calls[3]?.[2] as FormData).get("file_index"),
    ).toBe("1");
  });

  it("does not advance bytes while a chunk is pending or when the next chunk fails", async () => {
    const firstChunk = deferred<unknown>();
    vi.mocked(api)
      .mockResolvedValueOnce({
        upload_id: "bytes",
        file_count: 1,
        chunk_size: 4,
      })
      .mockImplementationOnce(() => firstChunk.promise)
      .mockRejectedValueOnce(new Error("Chunk rejected"));
    const onFileProgress = vi.fn();
    const onProgress = vi.fn();
    const result = uploadMusicFiles([new File(["abcdefg"], "track.flac")], {
      chunkedThresholdBytes: 4,
      onProgress,
      onFileProgress,
    });
    const rejected = expect(result).rejects.toThrow("Chunk rejected");
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    expect(onFileProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { fileIndex: 0, loadedBytes: 0, totalBytes: 7 },
    ]);
    expect(onProgress).not.toHaveBeenCalled();
    firstChunk.resolve({ ok: true });
    await rejected;
    expect(onFileProgress).toHaveBeenLastCalledWith({
      fileIndex: 0,
      loadedBytes: 4,
      totalBytes: 7,
    });
    expect(onProgress).toHaveBeenCalledExactlyOnceWith({ done: 1, total: 2 });
    expect(api).toHaveBeenCalledTimes(3);
  });

  it("does not fabricate file bytes for a direct fetch upload", async () => {
    const request = deferred<{
      task_id: string;
      upload_id: string;
      file_count: number;
      total_bytes: number;
    }>();
    vi.mocked(api).mockImplementationOnce(() => request.promise);
    const onFileProgress = vi.fn();
    const onProgress = vi.fn();
    const result = uploadMusicFiles([new File(["abc"], "track.flac")], {
      onProgress,
      onFileProgress,
    });
    expect(onFileProgress).not.toHaveBeenCalled();
    request.resolve({
      task_id: "task",
      upload_id: "direct",
      file_count: 1,
      total_bytes: 3,
    });
    await result;
    expect(onFileProgress).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
  });
});

describe("Upload file progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockReset();
  });

  it("shows one named indeterminate bar per file during a direct request and clears it on success", async () => {
    const request = deferred<{
      task_id: string;
      upload_id: string;
      file_count: number;
      total_bytes: number;
    }>();
    vi.mocked(api).mockImplementationOnce(() => request.promise);
    const { container } = renderWithListenProviders(<Upload />, {
      locale: "en",
    });
    const input = chooseFiles(container, [
      new File(["abc"], "first.flac"),
      new File(["abcde"], "second.flac"),
    ]);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Import to library" }));

    expect(input).toBeDisabled();
    expect(screen.getAllByRole("progressbar")).toHaveLength(2);
    for (const name of ["first.flac", "second.flac"]) {
      const bar = screen.getByRole("progressbar", { name });
      expect(bar).not.toHaveAttribute("aria-valuenow");
      expect(bar).toHaveAttribute("data-indeterminate", "true");
    }
    await act(async () =>
      request.resolve({
        task_id: "task",
        upload_id: "direct",
        file_count: 2,
        total_bytes: 8,
      }),
    );
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(input).not.toBeDisabled();
    expect(screen.queryByText("first.flac")).not.toBeInTheDocument();
  });

  it("uses confirmed file bytes for chunked uploads and discards failed progress before a retry", async () => {
    const size = 80 * 1024 * 1024 + 3;
    const file = new File(["abc"], "large.flac");
    Object.defineProperty(file, "size", { value: size });
    const firstChunk = deferred<unknown>();
    const rejectedChunk = deferred<unknown>();
    vi.mocked(api)
      .mockResolvedValueOnce({
        upload_id: "first",
        file_count: 1,
        chunk_size: size - 3,
      })
      .mockImplementationOnce(() => firstChunk.promise)
      .mockImplementationOnce(() => rejectedChunk.promise);
    const { container } = renderWithListenProviders(<Upload />, {
      locale: "en",
    });
    const input = chooseFiles(container, [file]);
    fireEvent.click(screen.getByRole("button", { name: "Import to library" }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    const bar = screen.getByRole("progressbar", { name: "large.flac" });
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    expect(bar).toHaveAttribute(
      "aria-valuetext",
      expect.stringMatching(/0.*80/),
    );
    await act(async () => firstChunk.resolve({ ok: true }));
    expect(Number(bar.getAttribute("aria-valuenow"))).toBeCloseTo(
      ((size - 3) / size) * 100,
      5,
    );
    expect(input).toBeDisabled();
    await act(async () => rejectedChunk.reject(new Error("Chunk rejected")));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(input).not.toBeDisabled();
    expect(screen.getByText("large.flac")).toBeInTheDocument();

    const retryInit = deferred<unknown>();
    const retryChunk = deferred<unknown>();
    vi.mocked(api)
      .mockImplementationOnce(() => retryInit.promise)
      .mockImplementationOnce(() => retryChunk.promise)
      .mockResolvedValueOnce({
        task_id: "task-retry",
        upload_id: "retry",
        file_count: 1,
        total_bytes: size,
      });
    fireEvent.click(screen.getByRole("button", { name: "Import to library" }));
    expect(
      screen.getByRole("progressbar", { name: "large.flac" }),
    ).not.toHaveAttribute("aria-valuenow");
    await act(async () =>
      retryInit.resolve({
        upload_id: "retry",
        file_count: 1,
        chunk_size: size,
      }),
    );
    expect(
      screen.getByRole("progressbar", { name: "large.flac" }),
    ).toHaveAttribute("aria-valuenow", "0");
    await act(async () => retryChunk.resolve({ ok: true }));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});

describe("Upload friendly receipt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockReset();
  });
  it.each([
    [
      "en",
      "Upload received. We’re adding your music to the library.",
      "2 files are being added to your library. You can keep browsing.",
    ],
    [
      "es",
      "Subida recibida. Estamos añadiendo tu música a la biblioteca.",
      "Estamos añadiendo 2 archivos a tu biblioteca. Puedes seguir navegando.",
    ],
  ] as const)(
    "confirms the upload and file count in %s without showing internal task IDs",
    async (locale, toast, receipt) => {
      vi.mocked(api).mockResolvedValueOnce({
        task_id: "internal-task-837",
        upload_id: "internal-upload-26",
        file_count: 2,
        total_bytes: 6,
      });
      const { container } = renderWithListenProviders(<Upload />, { locale });
      chooseFiles(container, [
        new File(["abc"], "First.flac"),
        new File(["abc"], "Second.flac"),
      ]);
      fireEvent.click(
        screen.getByRole("button", {
          name:
            locale === "es" ? "Importar a la biblioteca" : "Import to library",
        }),
      );
      await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith(toast));
      expect(screen.getByRole("status")).toHaveTextContent(receipt);
      expect(container).not.toHaveTextContent("internal-task-837");
      expect(container).not.toHaveTextContent("internal-upload-26");
    },
  );
});
