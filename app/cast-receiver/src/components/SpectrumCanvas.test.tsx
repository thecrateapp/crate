import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createReceiverStore } from "../receiver-store";
import type { CastSpectrumArtifact } from "../spectrum/format";
import { SpectrumCanvas } from "./SpectrumCanvas";

const item = {
  itemId: "item-1",
  track: { trackId: 1 },
  title: "Track",
  artist: "Artist",
  resources: {
    contentType: "audio/flac",
    metadataUrl: "https://api.test/item",
    streamUrl: "https://api.test/stream",
    spectrumUrl: "https://api.test/spectrum/private-lease",
  },
};

const artifact: CastSpectrumArtifact = {
  version: 1,
  bandCount: 24,
  frameCount: 1,
  sampleIntervalMs: 100,
  durationMs: 100,
  normalizationFloorDb: -80,
  frames: new Uint8Array(24),
};

describe("SpectrumCanvas", () => {
  it("loads the item artefact and updates playback without React frame churn", async () => {
    const store = createReceiverStore();
    const client = {
      load: vi.fn().mockResolvedValue(artifact),
      clear: vi.fn(),
    };
    const renderer = {
      start: vi.fn(),
      stop: vi.fn(),
      setPlaybackState: vi.fn(),
    };
    const rendererFactory = vi.fn(() => renderer);
    const view = render(
      <SpectrumCanvas
        client={client}
        item={item}
        phase="playing"
        progress={store.progress}
        reducedMotion={false}
        rendererFactory={rendererFactory}
      />,
    );

    await waitFor(() => expect(renderer.start).toHaveBeenCalledOnce());
    expect(client.load).toHaveBeenCalledWith(item.resources.spectrumUrl, {
      signal: expect.any(AbortSignal),
    });
    expect(view.getByTestId("cast-spectrum")).toHaveAttribute(
      "data-spectrum-state",
      "ready",
    );

    view.rerender(
      <SpectrumCanvas
        client={client}
        item={item}
        phase="paused"
        progress={store.progress}
        reducedMotion={false}
        rendererFactory={rendererFactory}
      />,
    );
    expect(renderer.setPlaybackState).toHaveBeenLastCalledWith({
      playing: false,
      reducedMotion: false,
    });

    view.unmount();
    expect(renderer.stop).toHaveBeenCalledOnce();
  });

  it("keeps an ambient fallback when the artefact is unavailable", async () => {
    const store = createReceiverStore();
    const client = {
      load: vi.fn().mockRejectedValue(new Error("unavailable")),
      clear: vi.fn(),
    };
    const rendererFactory = vi.fn();
    const view = render(
      <SpectrumCanvas
        client={client}
        item={item}
        phase="playing"
        progress={store.progress}
        reducedMotion={false}
        rendererFactory={rendererFactory}
      />,
    );

    await waitFor(() => expect(client.load).toHaveBeenCalledOnce());
    expect(view.getByTestId("cast-spectrum")).toHaveAttribute(
      "data-spectrum-state",
      "fallback",
    );
    expect(rendererFactory).not.toHaveBeenCalled();
  });

  it("uses the latest playback state when loading finishes", async () => {
    const store = createReceiverStore();
    let resolveArtifact: ((value: CastSpectrumArtifact) => void) | undefined;
    const client = {
      load: vi.fn(
        () =>
          new Promise<CastSpectrumArtifact>((resolve) => {
            resolveArtifact = resolve;
          }),
      ),
      clear: vi.fn(),
    };
    const renderer = {
      start: vi.fn(),
      stop: vi.fn(),
      setPlaybackState: vi.fn(),
    };
    const rendererFactory = vi.fn(() => renderer);
    const view = render(
      <SpectrumCanvas
        client={client}
        item={item}
        phase="playing"
        progress={store.progress}
        reducedMotion={false}
        rendererFactory={rendererFactory}
      />,
    );

    view.rerender(
      <SpectrumCanvas
        client={client}
        item={item}
        phase="paused"
        progress={store.progress}
        reducedMotion
        rendererFactory={rendererFactory}
      />,
    );
    resolveArtifact?.(artifact);

    await waitFor(() => expect(rendererFactory).toHaveBeenCalledOnce());
    expect(rendererFactory).toHaveBeenCalledWith(
      expect.objectContaining({ playing: false, reducedMotion: true }),
    );
  });
});
