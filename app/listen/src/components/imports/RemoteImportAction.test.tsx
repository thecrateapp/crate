import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { RemoteImportAction } from "./RemoteImportAction";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: vi.fn(),
    apiSseUrl: vi.fn((path: string) => path),
  };
});

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly url: string;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  listeners = new Map<string, (event: MessageEvent<string>) => void>();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(
      type,
      listener as unknown as (event: MessageEvent<string>) => void,
    );
  }

  emit(type: string, payload: unknown) {
    const event = { data: JSON.stringify(payload) } as MessageEvent<string>;
    if (type === "message") this.onmessage?.(event);
    this.listeners.get(type)?.(event);
  }
}

const mockedApi = vi.mocked(api);

describe("RemoteImportAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  it("asks for confirmation and creates one idempotent remote import request", async () => {
    mockedApi.mockResolvedValueOnce({
      request_id: "request-1",
      status: "awaiting_approval",
      task_id: null,
    });

    renderWithListenProviders(
      <RemoteImportAction
        globalAlbumUid="album-global-1"
        estimatedBytes={12_500_000}
        sourceName="Node B"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Make available locally" }),
    );
    expect(screen.getByText(/Node B/)).toBeInTheDocument();
    expect(screen.getByText(/12.5 MB/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        "/api/federation/remote/albums/album-global-1/import",
        "POST",
      ),
    );
    expect(
      await screen.findByText("Waiting for administrator approval"),
    ).toBeInTheDocument();
    expect(MockEventSource.instances[0]?.url).toBe("/api/events");
  });

  it("discovers approval from the global SSE signal and follows task progress", async () => {
    mockedApi
      .mockResolvedValueOnce({
        request_id: "request-1",
        status: "awaiting_approval",
        task_id: null,
      })
      .mockResolvedValueOnce({
        request_id: "request-1",
        status: "downloading",
        task_id: "task-1",
        received_bytes: 25,
        expected_bytes: 100,
      });

    renderWithListenProviders(
      <RemoteImportAction globalAlbumUid="album-global-1" />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Make available locally" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    await screen.findByText("Waiting for administrator approval");

    await act(async () => {
      MockEventSource.instances[0]?.emit("message", { tasks: [] });
    });

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        "/api/federation/remote/import-requests/request-1",
      ),
    );
    expect(await screen.findByText("Downloading 25%")).toBeInTheDocument();
    expect(MockEventSource.instances[1]?.url).toBe("/api/events/task/task-1");

    await act(async () => {
      MockEventSource.instances[1]?.emit("task_done", { status: "completed" });
    });
    expect(await screen.findByText("Available locally")).toBeInTheDocument();
  });

  it.each([
    ["failed", "Import failed"],
    ["cancelled", "Import cancelled"],
  ])("renders the %s terminal state", async (status, label) => {
    mockedApi.mockResolvedValueOnce({
      request_id: "request-1",
      status,
      task_id: null,
    });
    renderWithListenProviders(
      <RemoteImportAction globalAlbumUid="album-global-1" />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Make available locally" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  it("explains offline peers and missing permission without retry loops", async () => {
    mockedApi.mockRejectedValueOnce(
      Object.assign(new Error("Peer is disabled"), { status: 503 }),
    );
    renderWithListenProviders(
      <RemoteImportAction globalAlbumUid="album-global-1" />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Make available locally" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    expect(
      await screen.findByText("Remote node is unavailable"),
    ).toBeInTheDocument();

    mockedApi.mockRejectedValueOnce(
      Object.assign(new Error("Forbidden"), { status: 403 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    expect(
      await screen.findByText("You cannot request remote imports"),
    ).toBeInTheDocument();
  });
});
