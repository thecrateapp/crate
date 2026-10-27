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
    void setSpeed(float speed);
    long positionMs();

    boolean holdStart();

    long busFrame();

    long starvations();

    void startAtBusFrame(long busFrame);

    void releaseHold();

    default void startEnvelope(
        NativeMixAudioProcessor.Role role,
        long durationMs,
        float stagingGainDb,
        float bassHandoffAt
    ) {
        startEnvelope(role, durationMs, stagingGainDb, bassHandoffAt, false);
    }

    void startEnvelope(
        NativeMixAudioProcessor.Role role,
        long durationMs,
        float stagingGainDb,
        float bassHandoffAt,
        boolean djBlend
    );

    void clearEnvelope();

    float envelopeProgress();

    void releasePreparedSource();
}
