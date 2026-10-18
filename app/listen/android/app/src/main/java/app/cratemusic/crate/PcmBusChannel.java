package app.cratemusic.crate;

import java.util.concurrent.atomic.AtomicLong;

final class PcmBusChannel {
    private final PcmRingBuffer buffer;
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

    boolean blocksMix() {
        return playing && delivered && !endOfStream && buffer.availableFrames() == 0;
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

    synchronized int mixInto(float[] mix, float[] scratch, int frames) {
        if (!playing) return 0;
        int read = buffer.read(scratch, frames);
        float gain = volume;
        for (int index = 0; index < read * PcmBusMixer.CHANNELS; index++) {
            mix[index] += scratch[index] * gain;
        }
        consumedFrames.addAndGet(read);
        return read;
    }
}
