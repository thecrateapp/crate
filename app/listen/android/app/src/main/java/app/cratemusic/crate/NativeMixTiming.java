package app.cratemusic.crate;

final class NativeMixTiming {
    private static final long START_SAFETY_LEAD_MS = 50L;
    private static final long ACTIVE_TICK_MS = 20L;
    private static final long IDLE_MAX_TICK_MS = 1_000L;

    private NativeMixTiming() {}

    static boolean shouldStart(
        boolean isPlaying,
        long positionMs,
        long durationMs,
        long crossfadeMs
    ) {
        if (!isPlaying || durationMs <= 0L || crossfadeMs <= 0L) {
            return false;
        }
        long startPositionMs = Math.max(
            0L,
            durationMs - crossfadeMs - START_SAFETY_LEAD_MS
        );
        return positionMs >= startPositionMs && positionMs <= durationMs;
    }

    static float progress(
        long nowElapsedMs,
        long startedElapsedMs,
        long durationMs
    ) {
        if (durationMs <= 0L) {
            return 1.0f;
        }
        double progress =
            (nowElapsedMs - startedElapsedMs) / (double) durationMs;
        return (float) Math.max(0.0, Math.min(1.0, progress));
    }

    static long transitionDurationMs(
        long positionMs,
        long durationMs,
        long requestedCrossfadeMs
    ) {
        long remainingMs = Math.max(
            0L,
            durationMs - Math.max(0L, positionMs)
        );
        return Math.max(
            0L,
            Math.min(
                requestedCrossfadeMs,
                remainingMs - START_SAFETY_LEAD_MS
            )
        );
    }

    static long nextCheckDelayMs(
        long positionMs,
        long durationMs,
        long crossfadeMs
    ) {
        if (durationMs <= 0L || crossfadeMs <= 0L) {
            return IDLE_MAX_TICK_MS;
        }
        long startPositionMs = Math.max(
            0L,
            durationMs - crossfadeMs - START_SAFETY_LEAD_MS
        );
        long untilStartMs = startPositionMs - Math.max(0L, positionMs);
        if (untilStartMs <= ACTIVE_TICK_MS) {
            return ACTIVE_TICK_MS;
        }
        return Math.min(IDLE_MAX_TICK_MS, untilStartMs);
    }
}
