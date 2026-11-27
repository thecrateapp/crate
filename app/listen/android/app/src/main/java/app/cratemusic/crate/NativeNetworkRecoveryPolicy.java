package app.cratemusic.crate;

/**
 * When to re-prepare the player after it failed because the network was gone.
 *
 * <p>Armed by a connectivity error, it allows one attempt per interval for a
 * window that runs from the first failure: a failed attempt re-arms it without
 * extending the window. Disarmed when playback is ready again, the listener
 * pauses, the queue is replaced or the service stops.
 */
final class NativeNetworkRecoveryPolicy {
    private final long windowMs;
    private final long minIntervalMs;
    private long armedAtMs = -1L;
    private long lastAttemptMs = -1L;

    NativeNetworkRecoveryPolicy(long windowMs, long minIntervalMs) {
        this.windowMs = Math.max(0L, windowMs);
        this.minIntervalMs = Math.max(0L, minIntervalMs);
    }

    void arm(long nowMs) {
        if (armedAtMs < 0L) armedAtMs = nowMs;
    }

    boolean isArmed() {
        return armedAtMs >= 0L;
    }

    boolean isExpired(long nowMs) {
        return isArmed() && nowMs - armedAtMs > windowMs;
    }

    boolean shouldAttempt(long nowMs) {
        return isArmed() && !isExpired(nowMs) && delayUntilNextAttemptMs(nowMs) == 0L;
    }

    long delayUntilNextAttemptMs(long nowMs) {
        if (lastAttemptMs < 0L) return 0L;
        return Math.max(0L, lastAttemptMs + minIntervalMs - nowMs);
    }

    void markAttempt(long nowMs) {
        lastAttemptMs = nowMs;
    }

    void disarm() {
        armedAtMs = -1L;
        lastAttemptMs = -1L;
    }
}
