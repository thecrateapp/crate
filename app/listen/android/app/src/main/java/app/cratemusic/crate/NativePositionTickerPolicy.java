package app.cratemusic.crate;

final class NativePositionTickerPolicy {
    private NativePositionTickerPolicy() {}

    static long nextDelayMs(
        boolean isPlaying,
        boolean hasQueue,
        boolean foregroundBridgeAttached
    ) {
        if (!isPlaying || !hasQueue) return 0L;
        return foregroundBridgeAttached ? 500L : 1000L;
    }
}
