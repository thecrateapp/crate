import {
  addTrack,
  insertTrack as gpInsertTrack,
  loadQueue,
  next,
  pause,
  play,
  prev,
  removeTrack,
  seekTo,
  setCrossfadeDuration,
  setEqualizer,
  setLoop,
  setSingleMode,
  setPlaybackRate,
  setVolume,
  stop,
} from "@/lib/gapless-player";
import type {
  EngineEventListener,
  EngineEventName,
  EngineQueueSnapshot,
  EngineRepeatMode,
  EngineState,
  EngineTrack,
  PlaybackEngine,
} from "@/lib/playback-engine";

export class GaplessWebEngine implements PlaybackEngine {
  async loadQueue(snapshot: EngineQueueSnapshot): Promise<void> {
    loadQueue(
      snapshot.tracks.map((track) => track.url),
      snapshot.currentIndex,
      { restartIfSameIndex: true },
    );
    setVolume(snapshot.volume);
    setCrossfadeDuration(snapshot.crossfadeMs);
    await this.setRepeat(snapshot.repeat);
    if (snapshot.positionMs > 0) {
      seekTo(snapshot.positionMs);
    }
    if (snapshot.autoplay) {
      play();
    }
  }

  async play(): Promise<void> {
    play();
  }

  async pause(): Promise<void> {
    pause();
  }

  async stop(): Promise<void> {
    stop();
  }

  async seekTo(positionMs: number): Promise<void> {
    seekTo(positionMs);
  }

  async next(): Promise<void> {
    next();
  }

  async previous(): Promise<void> {
    prev();
  }

  async jumpTo(index: number, autoplay: boolean): Promise<void> {
    void index;
    void autoplay;
    // PlayerContext still owns jumpTo for the web engine while the native
    // migration boundary is being introduced.
  }

  async appendTracks(tracks: EngineTrack[]): Promise<void> {
    for (const track of tracks) {
      addTrack(track.url);
    }
  }

  async insertTrack(index: number, track: EngineTrack): Promise<void> {
    gpInsertTrack(index, track.url);
  }

  async removeTrack(index: number): Promise<void> {
    removeTrack(index);
  }

  async reorderTrack(fromIndex: number, toIndex: number): Promise<void> {
    void fromIndex;
    void toIndex;
    // React owns web-engine reordering today by rebuilding the queue.
  }

  async setRepeat(repeat: EngineRepeatMode): Promise<void> {
    setLoop(repeat === "all");
    setSingleMode(repeat === "one");
  }

  async setCrossfadeMs(ms: number): Promise<void> {
    setCrossfadeDuration(ms);
  }

  async setVolume(volume: number): Promise<void> {
    setVolume(volume);
  }

  async setPlaybackRate(rate: number): Promise<void> {
    setPlaybackRate(rate);
  }

  async setEq(enabled: boolean, gains: number[]): Promise<void> {
    setEqualizer(enabled, gains);
  }

  async getState(): Promise<EngineState | null> {
    return null;
  }

  async drainEvents(): Promise<[]> {
    return [];
  }

  async on<K extends EngineEventName>(
    event: K,
    listener: EngineEventListener<K>,
  ): Promise<() => void> {
    void event;
    void listener;
    return () => {};
  }

  async destroy(): Promise<void> {
    stop();
  }
}
