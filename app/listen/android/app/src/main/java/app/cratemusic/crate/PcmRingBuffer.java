package app.cratemusic.crate;

final class PcmRingBuffer {
    private final float[] samples;
    private final int channels;
    private final int capacityFrames;
    private volatile long writtenFrames;
    private volatile long readFrames;

    PcmRingBuffer(int capacityFrames, int channels) {
        this.capacityFrames = capacityFrames;
        this.channels = channels;
        this.samples = new float[capacityFrames * channels];
    }

    int capacityFrames() {
        return capacityFrames;
    }

    int availableFrames() {
        return (int) (writtenFrames - readFrames);
    }

    int writableFrames() {
        return capacityFrames - availableFrames();
    }

    int write(float[] source, int frames) {
        int count = Math.min(frames, writableFrames());
        long start = writtenFrames;
        int slot = (int) (start % capacityFrames);
        int first = Math.min(count, capacityFrames - slot);
        System.arraycopy(source, 0, samples, slot * channels, first * channels);
        System.arraycopy(source, first * channels, samples, 0, (count - first) * channels);
        writtenFrames = start + count;
        return count;
    }

    int read(float[] destination, int frames) {
        int count = Math.min(frames, availableFrames());
        long start = readFrames;
        int slot = (int) (start % capacityFrames);
        int first = Math.min(count, capacityFrames - slot);
        System.arraycopy(samples, slot * channels, destination, 0, first * channels);
        System.arraycopy(samples, 0, destination, first * channels, (count - first) * channels);
        readFrames = start + count;
        return count;
    }

    int skip(int frames) {
        int count = Math.min(frames, availableFrames());
        readFrames += count;
        return count;
    }

    void clear() {
        readFrames = writtenFrames;
    }
}
