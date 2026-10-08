import type { ReceiverStore } from "./receiver-store";

export function seedReceiverPreview(store: ReceiverStore): void {
  store.dispatch({ type: "load-started", sessionId: "preview-session" });
  store.dispatch({
    type: "session-loaded",
    appearance: {
      contractVersion: 1,
      skinId: "default",
      preferredMode: "dark",
      resolvedMode: "dark",
      reducedMotion: false,
    },
    queue: {
      queueRevision: 1,
      stateSeq: 1,
      currentIndex: 0,
      currentTime: 142,
      repeatMode: "off",
      shuffle: false,
      items: [
        {
          itemId: "preview-1",
          track: { trackId: 1 },
          title: "The Shape of Sound",
          artist: "Minor Empires",
          album: "United States of Emergency, Vol. 1",
          duration: 296,
          quality: "FLAC 24/96",
        },
        {
          itemId: "preview-2",
          track: { trackId: 2 },
          title: "Afterimage",
          artist: "Quicksand",
        },
        {
          itemId: "preview-3",
          track: { trackId: 3 },
          title: "New Noise",
          artist: "Refused",
        },
        {
          itemId: "preview-4",
          track: { trackId: 4 },
          title: "Arcarsenal",
          artist: "At the Drive-In",
        },
      ],
    },
  });
  store.dispatch({ type: "player-state", state: "PLAYING" });
  store.progress.set({ currentTime: 142, duration: 296 });
}
