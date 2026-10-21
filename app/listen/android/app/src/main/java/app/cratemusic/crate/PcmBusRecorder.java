package app.cratemusic.crate;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

final class PcmBusRecorder {
    static final int CHANNELS = 6;
    static final int POOL_BLOCKS = 512;
    private static final int HEADER_BYTES = 44;

    private final File file;
    private final int sampleRate;
    private final int blockFrames;
    private final ArrayBlockingQueue<short[]> free;
    private final ArrayBlockingQueue<short[]> filled;
    private final AtomicLong capturedFrames = new AtomicLong();
    private final AtomicLong droppedFrames = new AtomicLong();
    private final List<String> markers = new ArrayList<>();
    private final Thread writer;
    private volatile boolean running = true;
    private volatile IOException failure;
    private long writtenBytes;

    PcmBusRecorder(File file, int sampleRate, int blockFrames) throws IOException {
        this.file = file;
        this.sampleRate = sampleRate;
        this.blockFrames = blockFrames;
        free = new ArrayBlockingQueue<>(POOL_BLOCKS);
        filled = new ArrayBlockingQueue<>(POOL_BLOCKS);
        for (int index = 0; index < POOL_BLOCKS; index++) {
            free.add(new short[blockFrames * CHANNELS + 1]);
        }
        OutputStream output = new FileOutputStream(file);
        output.write(header(0L));
        writer = new Thread(() -> drain(output), "crate-pcm-bus-capture");
        writer.start();
    }

    void capture(short[] mix, float[] deck0, float[] deck1, int frames) {
        short[] block = free.poll();
        if (block == null) {
            droppedFrames.addAndGet(frames);
            return;
        }
        for (int frame = 0; frame < frames; frame++) {
            int source = frame * PcmBusMixer.CHANNELS;
            int target = frame * CHANNELS;
            block[target] = mix[source];
            block[target + 1] = mix[source + 1];
            block[target + 2] = toPcm16(deck0[source]);
            block[target + 3] = toPcm16(deck0[source + 1]);
            block[target + 4] = toPcm16(deck1[source]);
            block[target + 5] = toPcm16(deck1[source + 1]);
        }
        block[blockFrames * CHANNELS] = (short) frames;
        capturedFrames.addAndGet(frames);
        filled.offer(block);
    }

    synchronized void mark(String label) {
        markers.add(capturedFrames.get() + ":" + label);
    }

    synchronized List<String> markers() {
        return new ArrayList<>(markers);
    }

    long capturedFrames() {
        return capturedFrames.get();
    }

    long droppedFrames() {
        return droppedFrames.get();
    }

    File file() {
        return file;
    }

    void stop() throws IOException {
        running = false;
        try {
            writer.join(5_000L);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
        }
        if (failure != null) throw failure;
        try (RandomAccessFile output = new RandomAccessFile(file, "rw")) {
            output.seek(0L);
            output.write(header(writtenBytes));
        }
    }

    private void drain(OutputStream output) {
        ByteBuffer bytes = ByteBuffer.allocate(blockFrames * CHANNELS * 2)
            .order(ByteOrder.LITTLE_ENDIAN);
        try (OutputStream stream = output) {
            while (running || !filled.isEmpty()) {
                short[] block = filled.poll(20L, TimeUnit.MILLISECONDS);
                if (block == null) continue;
                int samples = block[blockFrames * CHANNELS] * CHANNELS;
                bytes.clear();
                for (int index = 0; index < samples; index++) bytes.putShort(block[index]);
                stream.write(bytes.array(), 0, samples * 2);
                writtenBytes += samples * 2L;
                free.offer(block);
            }
        } catch (IOException error) {
            failure = error;
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
        }
    }

    private byte[] header(long dataBytes) {
        ByteBuffer header = ByteBuffer.allocate(HEADER_BYTES).order(ByteOrder.LITTLE_ENDIAN);
        header.put(new byte[] { 'R', 'I', 'F', 'F' });
        header.putInt((int) Math.min(Integer.MAX_VALUE, dataBytes + HEADER_BYTES - 8));
        header.put(new byte[] { 'W', 'A', 'V', 'E', 'f', 'm', 't', ' ' });
        header.putInt(16);
        header.putShort((short) 1);
        header.putShort((short) CHANNELS);
        header.putInt(sampleRate);
        header.putInt(sampleRate * CHANNELS * 2);
        header.putShort((short) (CHANNELS * 2));
        header.putShort((short) 16);
        header.put(new byte[] { 'd', 'a', 't', 'a' });
        header.putInt((int) Math.min(Integer.MAX_VALUE, dataBytes));
        return header.array();
    }

    private static short toPcm16(float sample) {
        float scaled = sample * Short.MAX_VALUE;
        if (scaled > Short.MAX_VALUE) scaled = Short.MAX_VALUE;
        else if (scaled < -Short.MAX_VALUE) scaled = -Short.MAX_VALUE;
        return (short) (scaled + (scaled >= 0.0f ? 0.5f : -0.5f));
    }
}
