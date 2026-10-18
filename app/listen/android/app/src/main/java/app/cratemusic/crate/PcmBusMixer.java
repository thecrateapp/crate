package app.cratemusic.crate;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.util.Log;

import java.util.Arrays;
import java.util.concurrent.atomic.AtomicLong;

final class PcmBusMixer {
    static final int SAMPLE_RATE = 48_000;
    static final int CHANNELS = 2;
    static final int BLOCK_FRAMES = 480;
    private static final int CHANNEL_CAPACITY_FRAMES = SAMPLE_RATE / 2;

    private final PcmBusChannel[] channels = {
        new PcmBusChannel(CHANNEL_CAPACITY_FRAMES),
        new PcmBusChannel(CHANNEL_CAPACITY_FRAMES),
    };
    private final AtomicLong busFrames = new AtomicLong();
    private AudioTrack track;
    private Thread thread;
    private final PcmBusEqualizer equalizer = new PcmBusEqualizer(SAMPLE_RATE, CHANNELS);
    private volatile boolean running;

    PcmBusChannel channel(int index) {
        return channels[index];
    }

    PcmBusEqualizer equalizer() {
        return equalizer;
    }

    long busFrame() {
        return busFrames.get();
    }

    static int mixBlock(
        PcmBusChannel[] channels,
        float[] mix,
        float[] scratch,
        int frames,
        long blockStartFrame
    ) {
        Arrays.fill(mix, 0, frames * CHANNELS, 0.0f);
        for (PcmBusChannel channel : channels) {
            if (channel.blocksMix()) return 0;
        }
        int mixedFrames = 0;
        boolean scheduled = false;
        for (PcmBusChannel channel : channels) {
            scheduled |= channel.isScheduled();
            mixedFrames = Math.max(
                mixedFrames,
                channel.mixInto(mix, scratch, frames, blockStartFrame)
            );
        }
        if (mixedFrames == 0 && scheduled) return frames;
        return mixedFrames;
    }

    static void toPcm16(float[] mix, short[] output, int samples) {
        for (int index = 0; index < samples; index++) {
            float sample = Math.max(-1.0f, Math.min(1.0f, mix[index]));
            output[index] = (short) Math.round(sample * Short.MAX_VALUE);
        }
    }

    synchronized void ensureStarted(int audioSessionId) {
        if (running) return;
        int minimumBytes = AudioTrack.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT_STEREO,
            AudioFormat.ENCODING_PCM_16BIT
        );
        AudioTrack.Builder builder = new AudioTrack.Builder()
            .setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
            )
            .setAudioFormat(
                new AudioFormat.Builder()
                    .setSampleRate(SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .build()
            )
            .setBufferSizeInBytes(Math.max(minimumBytes, BLOCK_FRAMES * CHANNELS * 2 * 4))
            .setTransferMode(AudioTrack.MODE_STREAM);
        if (audioSessionId > 0) builder.setSessionId(audioSessionId);
        track = builder.build();
        track.play();
        running = true;
        thread = new Thread(this::run, "crate-pcm-bus");
        thread.setPriority(Thread.MAX_PRIORITY);
        thread.start();
    }

    private void run() {
        float[] mix = new float[BLOCK_FRAMES * CHANNELS];
        float[] scratch = new float[BLOCK_FRAMES * CHANNELS];
        short[] output = new short[BLOCK_FRAMES * CHANNELS];
        while (running) {
            int frames = mixBlock(channels, mix, scratch, BLOCK_FRAMES, busFrames.get());
            busFrames.addAndGet(frames);
            if (frames == 0) {
                try {
                    Thread.sleep(2L);
                } catch (InterruptedException error) {
                    return;
                }
                continue;
            }
            equalizer.process(mix, frames);
            toPcm16(mix, output, frames * CHANNELS);
            int written = track.write(output, 0, frames * CHANNELS, AudioTrack.WRITE_BLOCKING);
            if (written < 0) {
                Log.w(NativeMixAudioProcessor.QOE_TAG, "pcm bus write failed=" + written);
            }
        }
    }

    synchronized void release() {
        running = false;
        if (thread != null) thread.interrupt();
        if (track != null) {
            track.release();
            track = null;
        }
    }
}
