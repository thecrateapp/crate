package app.cratemusic.crate;

final class NativeMixTiming {
    private NativeMixTiming() {}

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
}
