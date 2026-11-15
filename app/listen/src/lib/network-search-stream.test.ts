import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  apiSseUrl: (path: string) => path,
  ensureMediaAccessUrl: vi.fn(async (path: string) => path + "&media_ticket=t"),
}));

import {
  networkSearchStreamPath,
  openNetworkSearchStream,
  type NetworkSearchHandlers,
} from "@/lib/network-search-stream";

class FakeEventSource {
  static last: FakeEventSource | null = null;
  url: string;
  options: EventSourceInit | undefined;
  closed = false;
  onerror: (() => void) | null = null;
  listeners = new Map<string, (event: MessageEvent<string>) => void>();

  constructor(url: string, options?: EventSourceInit) {
    this.url = url;
    this.options = options;
    FakeEventSource.last = this;
  }

  addEventListener(
    name: string,
    listener: (event: MessageEvent<string>) => void,
  ) {
    this.listeners.set(name, listener);
  }

  emit(name: string, payload: unknown) {
    this.listeners.get(name)?.({
      data: JSON.stringify(payload),
    } as MessageEvent<string>);
  }

  close() {
    this.closed = true;
  }
}

function handlers(): NetworkSearchHandlers {
  return {
    onLocal: vi.fn(),
    onCoverage: vi.fn(),
    onRemote: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
  };
}

describe("openNetworkSearchStream", () => {
  beforeEach(() => {
    FakeEventSource.last = null;
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  async function opened(): Promise<FakeEventSource> {
    await vi.waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    return FakeEventSource.last!;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks the streamed search endpoint with a media ticket", async () => {
    openNetworkSearchStream("joy division", handlers(), 20);

    const source = await opened();
    const url = new URL(source.url, "https://listen.test");
    expect(url.searchParams.get("media_ticket")).toBe("t");
    expect(url.pathname).toBe("/api/catalog/search-stream");
    expect(url.searchParams.get("q")).toBe("joy division");
    expect(url.searchParams.get("limit")).toBe("20");
    expect(networkSearchStreamPath("a&b", 20)).toBe(
      "/api/catalog/search-stream?q=a%26b&limit=20",
    );
  });

  it("delivers each event and closes on done", async () => {
    const on = handlers();
    openNetworkSearchStream("joy", on);
    const source = await opened();

    source.emit("local", {
      query: "joy",
      results: { artists: [], albums: [], tracks: [] },
    });
    source.emit("coverage", { state: "searching" });
    source.emit("remote", {
      results: { artists: [], albums: [], tracks: [] },
      coverage: { state: "searching" },
    });
    source.emit("done", { coverage: { state: "complete" } });
    source.emit("remote", { results: {}, coverage: {} });

    expect(on.onLocal).toHaveBeenCalledTimes(1);
    expect(on.onCoverage).toHaveBeenCalledWith({ state: "searching" });
    expect(on.onRemote).toHaveBeenCalledTimes(1);
    expect(on.onDone).toHaveBeenCalledWith({ state: "complete" });
    expect(source.closed).toBe(true);
  });

  it("closes on error so the browser never repeats the search", async () => {
    const on = handlers();
    openNetworkSearchStream("joy", on);
    const source = await opened();
    source.emit("local", { results: { artists: [], albums: [], tracks: [] } });

    source.onerror!();
    source.onerror!();

    expect(source.closed).toBe(true);
    expect(on.onError).toHaveBeenCalledTimes(1);
    expect(on.onError).toHaveBeenCalledWith(false);
  });

  it("reports an error before local results so the page can fall back", async () => {
    const on = handlers();
    openNetworkSearchStream("joy", on);

    (await opened()).onerror!();

    expect(on.onError).toHaveBeenCalledWith(true);
  });

  it("never opens a source once closed", async () => {
    const close = openNetworkSearchStream("joy", handlers());
    close();
    await Promise.resolve();
    await Promise.resolve();

    expect(FakeEventSource.last).toBeNull();
  });
});
