package app.cratemusic.crate;

import androidx.annotation.Nullable;

final class NativeContinuationPolicy {
    static final int MIN_PLANNED_EDGES = 3;
    static final int MAX_EDGES = 32;
    private static final long[] BACKOFF_MS = {10_000L, 30_000L, 60_000L, 300_000L};

    static final class Window {
        final int fromIndex;
        final int edgeCount;

        Window(int fromIndex, int edgeCount) {
            this.fromIndex = fromIndex;
            this.edgeCount = edgeCount;
        }
    }

    private boolean inFlight;
    private boolean unauthorized;
    private boolean exhausted;
    private int failures;
    private long retryAtMs;
    private long generation;

    long generation() {
        return generation;
    }

    boolean acceptsResult(long requestGeneration) {
        return inFlight && requestGeneration == generation;
    }

    long retryDelayMs(long nowMs) {
        if (unauthorized || exhausted || inFlight || retryAtMs == 0L) return -1L;
        return Math.max(0L, retryAtMs - nowMs);
    }

    @Nullable
    Window nextRequest(
        boolean foreground,
        boolean configured,
        boolean mixEnabled,
        int currentIndex,
        int queueSize,
        int plannedEdgesAhead,
        long nowMs
    ) {
        if (foreground || !configured || !mixEnabled || unauthorized || inFlight) {
            return null;
        }
        if (nowMs < retryAtMs) return null;
        int remainingEdges = queueSize - 1 - currentIndex;
        if (currentIndex < 0 || remainingEdges <= 0) return null;
        if (plannedEdgesAhead >= Math.min(MIN_PLANNED_EDGES, remainingEdges)) {
            return null;
        }
        inFlight = true;
        return new Window(currentIndex, Math.min(MAX_EDGES, remainingEdges));
    }

    boolean nextRefill(
        boolean foreground,
        boolean configured,
        int currentIndex,
        int queueSize,
        long nowMs
    ) {
        if (foreground || !configured || unauthorized || exhausted || inFlight) {
            return false;
        }
        if (nowMs < retryAtMs || currentIndex < 0) return false;
        if (queueSize - 1 - currentIndex > MIN_PLANNED_EDGES) return false;
        inFlight = true;
        return true;
    }

    void onExhausted() {
        inFlight = false;
        exhausted = true;
    }

    void onSuccess() {
        inFlight = false;
        failures = 0;
        retryAtMs = 0L;
    }

    void onFailure(long nowMs) {
        inFlight = false;
        retryAtMs = nowMs + BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)];
        failures++;
    }

    void onUnauthorized() {
        inFlight = false;
        unauthorized = true;
    }

    void reset() {
        generation++;
        inFlight = false;
        unauthorized = false;
        exhausted = false;
        failures = 0;
        retryAtMs = 0L;
    }
}
