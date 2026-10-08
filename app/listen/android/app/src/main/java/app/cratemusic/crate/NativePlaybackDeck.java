package app.cratemusic.crate;

interface NativePlaybackDeck {
    void prepare(NativeTrack track, long startPositionMs);

    boolean isReadyFor(NativeTrack track);

    boolean isReadyAt(NativeTrack track, long positionMs, long minimumBufferedMs);

    void play();

    void pause();

    void stop();

    void seekTo(long positionMs);

    void setVolume(float volume);

    void releasePreparedSource();
}
