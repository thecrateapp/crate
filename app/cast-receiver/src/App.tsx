import { useSyncExternalStore } from "react";

import { resolveReceiverAppearance } from "./appearance";
import { Artwork } from "./components/Artwork";
import { NowPlaying } from "./components/NowPlaying";
import { QueuePreview } from "./components/QueuePreview";
import type { ReceiverPhase, ReceiverStore } from "./receiver-store";

interface AppProps {
  store: ReceiverStore;
}

function CrateMark() {
  return (
    <div className="crate-mark" aria-label="Crate">
      <svg aria-hidden="true" viewBox="0 0 48 48">
        <path d="M8 7h32v34H8zM14 13v22h20V13zm4 4h12v4H18zm0 10h12v4H18z" />
      </svg>
      <span>CRATE</span>
    </div>
  );
}

const STATUS_COPY: Record<ReceiverPhase, string> = {
  buffering: "Buffering audio",
  error: "Playback unavailable",
  idle: "Ready to cast",
  loading: "Connecting to Crate",
  paused: "Playback paused",
  playing: "Playing on Crate",
  recovering: "Trying the next source",
};

function StatusScreen({
  message,
  phase,
}: {
  message: string | null;
  phase: ReceiverPhase;
}) {
  return (
    <main className="receiver-status">
      <CrateMark />
      <div
        className={`status-orbit status-orbit-${phase}`}
        aria-hidden="true"
      />
      <h1>{message || STATUS_COPY[phase]}</h1>
      <p>Choose music in Crate to begin listening.</p>
    </main>
  );
}

export function App({ store }: AppProps) {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const appearance = resolveReceiverAppearance(snapshot.appearance);
  const item = snapshot.items[snapshot.currentIndex];

  return (
    <div
      className="receiver-app"
      data-mode={appearance.mode}
      data-reduced-motion={appearance.reducedMotion ? "true" : "false"}
      data-skin={appearance.skinId}
      style={appearance.cssVariables}
    >
      {item ? (
        <main className="tv-safe-frame">
          <header>
            <CrateMark />
          </header>
          <div className="receiver-grid">
            <Artwork item={item} />
            <NowPlaying
              item={item}
              phase={snapshot.phase}
              progress={store.progress}
            />
            <QueuePreview
              currentIndex={snapshot.currentIndex}
              items={snapshot.items}
            />
          </div>
        </main>
      ) : (
        <StatusScreen message={snapshot.message} phase={snapshot.phase} />
      )}
    </div>
  );
}
