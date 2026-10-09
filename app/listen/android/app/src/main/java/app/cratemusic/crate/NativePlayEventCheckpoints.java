package app.cratemusic.crate;

import androidx.annotation.Nullable;

final class NativePlayEventCheckpoints {
    static final class Checkpoint {
        final int index;
        final String trackId;
        final long positionMs;
        final boolean firstForTrack;

        Checkpoint(int index, String trackId, long positionMs, boolean firstForTrack) {
            this.index = index;
            this.trackId = trackId;
            this.positionMs = positionMs;
            this.firstForTrack = firstForTrack;
        }
    }

    private final long intervalMs;
    private int lastIndex = -1;
    private String lastTrackId = "";
    private long lastPositionMs;

    NativePlayEventCheckpoints(long intervalMs) {
        this.intervalMs = intervalMs;
    }

    @Nullable
    Checkpoint observe(int index, String trackId, long positionMs, boolean playing) {
        if (!playing || index < 0) {
            return null;
        }
        String safeTrackId = trackId == null ? "" : trackId;
        long safePositionMs = Math.max(0L, positionMs);
        boolean trackChanged = index != lastIndex || !safeTrackId.equals(lastTrackId);
        boolean movedBackwards = safePositionMs < lastPositionMs;
        boolean intervalElapsed = safePositionMs - lastPositionMs >= intervalMs;
        if (!trackChanged && !movedBackwards && !intervalElapsed) {
            return null;
        }
        lastIndex = index;
        lastTrackId = safeTrackId;
        lastPositionMs = safePositionMs;
        return new Checkpoint(index, safeTrackId, safePositionMs, trackChanged);
    }

    void reset() {
        lastIndex = -1;
        lastTrackId = "";
        lastPositionMs = 0L;
    }
}
