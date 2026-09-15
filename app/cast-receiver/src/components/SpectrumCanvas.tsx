import type { CastQueueItem } from "@crate/cast-protocol";
import { useEffect, useRef } from "react";

import type { ReceiverPhase, ReceiverStore } from "../receiver-store";
import { spectrumClient, type SpectrumClient } from "../spectrum/client";
import {
  createSpectrumRenderer,
  type SpectrumRenderer,
} from "../spectrum/renderer";

interface SpectrumCanvasProps {
  item: CastQueueItem;
  phase: ReceiverPhase;
  progress: ReceiverStore["progress"];
  reducedMotion: boolean;
  client?: SpectrumClient;
  rendererFactory?: typeof createSpectrumRenderer;
}

export function SpectrumCanvas({
  item,
  phase,
  progress,
  reducedMotion,
  client = spectrumClient,
  rendererFactory = createSpectrumRenderer,
}: SpectrumCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SpectrumRenderer | null>(null);
  const playing = phase === "playing";
  const playbackStateRef = useRef({ playing, reducedMotion });
  const spectrumUrl = item.resources?.spectrumUrl;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    rendererRef.current?.stop();
    rendererRef.current = null;
    canvas.dataset.spectrumState = "fallback";
    if (!spectrumUrl) return;

    const controller = new AbortController();
    void client
      .load(spectrumUrl, { signal: controller.signal })
      .then((artifact) => {
        if (controller.signal.aborted) return;
        const renderer = rendererFactory({
          artifact,
          canvas,
          progress,
          ...playbackStateRef.current,
        });
        rendererRef.current = renderer;
        canvas.dataset.spectrumState = "ready";
        renderer.start();
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          canvas.dataset.spectrumState = "fallback";
        }
      });

    return () => {
      controller.abort();
      rendererRef.current?.stop();
      rendererRef.current = null;
    };
  }, [client, item.itemId, progress, rendererFactory, spectrumUrl]);

  useEffect(() => {
    const playbackState = { playing, reducedMotion };
    playbackStateRef.current = playbackState;
    rendererRef.current?.setPlaybackState(playbackState);
  }, [playing, reducedMotion]);

  return (
    <div className="spectrum-shell" aria-hidden="true">
      <div className="spectrum-ambient" />
      <canvas
        className="spectrum-canvas"
        data-spectrum-state="fallback"
        data-testid="cast-spectrum"
        ref={canvasRef}
      />
    </div>
  );
}
