import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  networkSearchStreamPath,
  openNetworkSearchStream,
  type NetworkSearchHandlers,
} from "@/lib/network-search-stream";

class FakeEventSource {
  static last: FakeEventSource | null = null;
  url: string;
  closed = false;
  onerror: (() => void) | null = null;
  listeners = new Map<string, (event: MessageEvent<string>) => void>();

  constructor(url: string) {
    this.url = url;
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
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks the streamed search endpoint", () => {
    openNetworkSearchStream("joy division", handlers(), 20);

    const url = new URL(FakeEventSource.last!.url, "https://listen.test");
    expect(url.pathname).toBe("/api/catalog/search-stream");
    expect(url.searchParams.get("q")).toBe("joy division");
    expect(url.searchParams.get("limit")).toBe("20");
    expect(networkSearchStreamPath("a&b", 20)).toBe(
      "/api/catalog/search-stream?q=a%26b&limit=20",
    );
  });

  it("delivers each event and closes on done", () => {
    const on = handlers();
    openNetworkSearchStream("joy", on);
    const source = FakeEventSource.last!;

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

  it("closes on error so the browser never repeats the search", () => {
    const on = handlers();
    openNetworkSearchStream("joy", on);
    const source = FakeEventSource.last!;
    source.emit("local", { results: { artists: [], albums: [], tracks: [] } });

    source.onerror!();
    source.onerror!();

    expect(source.closed).toBe(true);
    expect(on.onError).toHaveBeenCalledTimes(1);
    expect(on.onError).toHaveBeenCalledWith(false);
  });

  it("reports an error before local results so the page can fall back", () => {
    const on = handlers();
    openNetworkSearchStream("joy", on);

    FakeEventSource.last!.onerror!();

    expect(on.onError).toHaveBeenCalledWith(true);
  });
});
