package app.cratemusic.crate;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.util.Log;

import java.util.Arrays;

final class PcmBusMixer {
    static final int SAMPLE_RATE = 48_000;
    static final int CHANNELS = 2;
    static final int BLOCK_FRAMES = 480;
    private static final int CHANNEL_CAPACITY_FRAMES = SAMPLE_RATE / 2;

    private final PcmBusChannel[] channels = {
        new PcmBusChannel(CHANNEL_CAPACITY_FRAMES),
        new PcmBusChannel(CHANNEL_CAPACITY_FRAMES),
    };
    private AudioTrack track;
    private Thread thread;
    private volatile boolean running;

    PcmBusChannel channel(int index) {
        return channels[index];
    }

    static int mixBlock(PcmBusChannel[] channels, float[] mix, float[] scratch, int frames) {
        Arrays.fill(mix, 0, frames * CHANNELS, 0.0f);
        int mixedFrames = 0;
        for (PcmBusChannel channel : channels) {
            mixedFrames = Math.max(mixedFrames, channel.mixInto(mix, scratch, frames));
        }
        for (int index = 0; index < mixedFrames * CHANNELS; index++) {
            mix[index] = Math.max(-1.0f, Math.min(1.0f, mix[index]));
        }
        return mixedFrames;
    }

    synchronized void ensureStarted(int audioSessionId) {
        if (running) return;
        int minimumBytes = AudioTrack.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT_STEREO,
            AudioFormat.ENCODING_PCM_FLOAT
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
                    .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                    .build()
            )
            .setBufferSizeInBytes(Math.max(minimumBytes, BLOCK_FRAMES * CHANNELS * 4 * 4))
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
        while (running) {
            int frames = mixBlock(channels, mix, scratch, BLOCK_FRAMES);
            if (frames == 0) {
                try {
                    Thread.sleep(2L);
                } catch (InterruptedException error) {
                    return;
                }
                continue;
            }
            int written = track.write(mix, 0, frames * CHANNELS, AudioTrack.WRITE_BLOCKING);
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
