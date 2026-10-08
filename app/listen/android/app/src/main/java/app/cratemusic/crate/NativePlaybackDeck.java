package app.cratemusic.crate;

interface NativePlaybackDeck {
    void prepare(NativeTrack track, long startPositionMs);

    boolean isReadyFor(NativeTrack track);

    void play();

    void pause();

    void stop();

    void seekTo(long positionMs);

    void setVolume(float volume);

    void releasePreparedSource();
}
