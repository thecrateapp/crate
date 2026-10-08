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
    }

    @Override
    public boolean isReadyFor(NativeTrack track) {
        return preparedTrack != null && preparedTrack.id.equals(track.id);
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
    }
}
