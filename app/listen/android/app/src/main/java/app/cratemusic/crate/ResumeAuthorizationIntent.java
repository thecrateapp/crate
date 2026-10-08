package app.cratemusic.crate;

final class ResumeAuthorizationIntent {
    final int index;
    final long positionMs;
    final boolean playWhenReady;
    private final int queueSize;

    ResumeAuthorizationIntent(
        int index,
        long positionMs,
        boolean playWhenReady,
        int queueSize
    ) {
        this.queueSize = Math.max(0, queueSize);
        this.index = clampIndex(index, this.queueSize);
        this.positionMs = Math.max(0L, positionMs);
        this.playWhenReady = playWhenReady;
    }

    ResumeAuthorizationIntent withPlayWhenReady(boolean nextPlayWhenReady) {
        return new ResumeAuthorizationIntent(index, positionMs, nextPlayWhenReady, queueSize);
    }

    ResumeAuthorizationIntent seekTo(long nextPositionMs) {
        return new ResumeAuthorizationIntent(index, nextPositionMs, playWhenReady, queueSize);
    }

    ResumeAuthorizationIntent jumpTo(int nextIndex, boolean autoplay) {
        return new ResumeAuthorizationIntent(nextIndex, 0L, autoplay, queueSize);
    }

    ResumeAuthorizationIntent next() {
        return new ResumeAuthorizationIntent(index + 1, 0L, playWhenReady, queueSize);
    }

    ResumeAuthorizationIntent previous() {
        return new ResumeAuthorizationIntent(index - 1, 0L, playWhenReady, queueSize);
    }

    private static int clampIndex(int index, int queueSize) {
        if (queueSize <= 0) return 0;
        return Math.max(0, Math.min(index, queueSize - 1));
    }
}
