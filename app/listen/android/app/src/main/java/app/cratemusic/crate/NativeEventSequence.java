package app.cratemusic.crate;

import java.util.concurrent.atomic.AtomicLong;

final class NativeEventSequence {
    private final AtomicLong value = new AtomicLong();

    long next() {
        return value.incrementAndGet();
    }
}
