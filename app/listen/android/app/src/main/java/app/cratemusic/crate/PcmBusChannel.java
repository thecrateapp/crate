package app.cratemusic.crate;

import java.util.concurrent.atomic.AtomicLong;

final class PcmBusChannel {
    static final long RUNNING = Long.MIN_VALUE;
    static final long HELD = Long.MAX_VALUE;

    private final PcmRingBuffer buffer;
    private final AtomicLong startFrame = new AtomicLong(RUNNING);
    private final AtomicLong consumedFrames = new AtomicLong();
    private volatile boolean playing;
    private volatile float volume = 1.0f;
    private volatile boolean endOfStream;
    private volatile boolean delivered;

    PcmBusChannel(int capacityFrames) {
        buffer = new PcmRingBuffer(capacityFrames, PcmBusMixer.CHANNELS);
    }

    PcmRingBuffer buffer() {
        return buffer;
    }

    int write(float[] frames, int count) {
        int written = buffer.write(frames, count);
        if (written > 0) delivered = true;
        return written;
    }

    void setPlaying(boolean playing) {
        this.playing = playing;
        if (playing) endOfStream = false;
    }

    void markEndOfStream() {
        endOfStream = true;
    }

    void hold() {
        startFrame.set(HELD);
    }

    void startAt(long busFrame) {
        long current = startFrame.get();
        while (current != RUNNING && !startFrame.compareAndSet(current, busFrame)) {
            current = startFrame.get();
        }
    }

    void releaseHold() {
        startFrame.set(RUNNING);
    }

    boolean isScheduled() {
        long start = startFrame.get();
        return playing && start != RUNNING && start != HELD;
    }

    boolean blocksMix() {
        return (
            playing &&
            delivered &&
            !endOfStream &&
            startFrame.get() == RUNNING &&
            buffer.availableFrames() == 0
        );
    }

    boolean isPlaying() {
        return playing;
    }

    void setVolume(float volume) {
        this.volume = volume;
    }

    long consumedFrames() {
        return consumedFrames.get();
    }

    synchronized void flush() {
        endOfStream = false;
        delivered = false;
        buffer.clear();
        consumedFrames.set(0L);
    }

    synchronized int mixInto(float[] mix, float[] scratch, int frames, long blockStartFrame) {
        if (!playing) return 0;
        int offset = 0;
        long start = startFrame.get();
        if (start != RUNNING) {
            if (start >= blockStartFrame + frames) return 0;
            if (!startFrame.compareAndSet(start, RUNNING)) return 0;
            if (start > blockStartFrame) {
                offset = (int) (start - blockStartFrame);
            } else {
                long lateFrames = Math.min(blockStartFrame - start, buffer.availableFrames());
                consumedFrames.addAndGet(buffer.skip((int) lateFrames));
            }
        }
        int read = buffer.read(scratch, frames - offset);
        float gain = volume;
        int base = offset * PcmBusMixer.CHANNELS;
        for (int index = 0; index < read * PcmBusMixer.CHANNELS; index++) {
            mix[base + index] += scratch[index] * gain;
        }
        consumedFrames.addAndGet(read);
        return read == 0 ? 0 : offset + read;
    }
}
