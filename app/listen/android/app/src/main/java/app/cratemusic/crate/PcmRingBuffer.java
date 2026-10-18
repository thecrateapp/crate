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
        for (int frame = 0; frame < count; frame++) {
            int slot = (int) ((start + frame) % capacityFrames) * channels;
            System.arraycopy(source, frame * channels, samples, slot, channels);
        }
        writtenFrames = start + count;
        return count;
    }

    int read(float[] destination, int frames) {
        int count = Math.min(frames, availableFrames());
        long start = readFrames;
        for (int frame = 0; frame < count; frame++) {
            int slot = (int) ((start + frame) % capacityFrames) * channels;
            System.arraycopy(samples, slot, destination, frame * channels, channels);
        }
        readFrames = start + count;
        return count;
    }

    void clear() {
        readFrames = writtenFrames;
    }
}
