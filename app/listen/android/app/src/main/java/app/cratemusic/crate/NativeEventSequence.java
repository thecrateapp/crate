package app.cratemusic.crate;

import java.util.concurrent.atomic.AtomicLong;

final class NativeEventSequence {
    private static final AtomicLong value = new AtomicLong();

    long next() {
        return value.incrementAndGet();
    }

    /**
     * Keeps sequences monotonic across process restarts: events replayed from
     * the durable log must stay older than anything this process emits.
     */
    static void advanceTo(long floor) {
        value.accumulateAndGet(floor, Math::max);
    }
}
