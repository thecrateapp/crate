package app.cratemusic.crate;

final class NativeInterruptionCoordinator {
    enum FocusChange {
        GAIN,
        LOSS,
        TRANSIENT_LOSS,
        DUCK
    }

    interface Playback {
        boolean isPlaying();

        void cancelTransition(String reason);

        void pause();

        void play();

        void setDuckMultiplier(float multiplier);

        void checkpoint();
    }

    private static final float DUCK_MULTIPLIER = 0.2f;

    private final Playback playback;
    private boolean resumeOnFocusGain;

    NativeInterruptionCoordinator(Playback playback) {
        if (playback == null) {
            throw new IllegalArgumentException("Playback is required");
        }
        this.playback = playback;
    }

    void onFocusChange(FocusChange change) {
        if (change == null) return;
        switch (change) {
            case GAIN:
                playback.setDuckMultiplier(1.0f);
                if (resumeOnFocusGain) {
                    resumeOnFocusGain = false;
                    playback.play();
                }
                return;
            case DUCK:
                playback.setDuckMultiplier(DUCK_MULTIPLIER);
                return;
            case TRANSIENT_LOSS:
                pauseForInterruption("audio_focus_transient", true);
                return;
            case LOSS:
                pauseForInterruption("audio_focus_loss", false);
                return;
        }
    }

    void onNoisyRoute() {
        pauseForInterruption("audio_becoming_noisy", false);
    }

    void onProcessStop() {
        pauseForInterruption("process_stop", false);
    }

    void onUserPause() {
        resumeOnFocusGain = false;
        playback.setDuckMultiplier(1.0f);
    }

    boolean willResumeOnFocusGain() {
        return resumeOnFocusGain;
    }

    private void pauseForInterruption(
        String reason,
        boolean mayResume
    ) {
        boolean wasPlaying = playback.isPlaying();
        resumeOnFocusGain = mayResume && wasPlaying;
        playback.setDuckMultiplier(1.0f);
        playback.cancelTransition(reason);
        if (wasPlaying) {
            playback.pause();
        }
        playback.checkpoint();
    }
}
