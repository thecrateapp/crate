package app.cratemusic.crate;

import java.util.ArrayList;
import java.util.List;

final class FakeNativePlaybackDeck implements NativePlaybackDeck {
    final String name;
    final List<String> calls = new ArrayList<>();
    NativeTrack preparedTrack;
    long positionMs;
    float volume = 1.0f;
    boolean playing;
    boolean released;
    boolean failPreparation;
    boolean autoReady = true;
    boolean ready;
    long bufferedAheadMs = 30_000L;

    FakeNativePlaybackDeck(String name) {
        this.name = name;
    }

    @Override
    public void prepare(NativeTrack track, long startPositionMs) {
        calls.add("prepare:" + track.id);
        if (failPreparation) {
            throw new IllegalStateException("preparation failed");
        }
        preparedTrack = track;
        positionMs = startPositionMs;
        released = false;
        ready = autoReady;
    }

    void completePreparation() {
        ready = preparedTrack != null;
    }

    @Override
    public boolean isReadyFor(NativeTrack track) {
        return preparedTrack != null && preparedTrack.id.equals(track.id);
    }

    @Override
    public boolean isReadyAt(
        NativeTrack track,
        long requestedPositionMs,
        long minimumBufferedMs
    ) {
        return (
            ready &&
            isReadyFor(track) &&
            positionMs == requestedPositionMs &&
            bufferedAheadMs >= minimumBufferedMs
        );
    }

    @Override
    public void play() {
        calls.add("play");
        playing = true;
    }

    @Override
    public void pause() {
        calls.add("pause");
        playing = false;
    }

    @Override
    public void stop() {
        calls.add("stop");
        playing = false;
    }

    @Override
    public void seekTo(long requestedPositionMs) {
        calls.add("seek:" + requestedPositionMs);
        positionMs = requestedPositionMs;
        ready = false;
    }

    @Override
    public void setVolume(float requestedVolume) {
        calls.add("volume:" + requestedVolume);
        volume = requestedVolume;
    }

    @Override
    public void releasePreparedSource() {
        calls.add("release");
        preparedTrack = null;
        released = true;
        playing = false;
        ready = false;
    }
}
