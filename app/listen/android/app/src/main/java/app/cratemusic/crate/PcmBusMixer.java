package app.cratemusic.crate;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.SystemClock;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
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
    private Thread thread;
    private final PcmBusEqualizer equalizer = new PcmBusEqualizer(SAMPLE_RATE, CHANNELS);
    static final long IDLE_PAUSE_MS = 500L;

    private final AtomicLong busStalls = new AtomicLong();
    private volatile PcmBusRecorder recorder;
    private int captureUnderrunsAtStart;
    private long captureStallsAtStart;
    private long captureStartedAtMs;
    private volatile boolean running;
    private volatile AudioTrack track;
    private int audioSessionId;

    PcmBusChannel channel(int index) {
        return channels[index];
    }

    synchronized void startCapture(File file) throws IOException {
        if (recorder != null) {
            recorder.stop();
            recorder = null;
        }
        AudioTrack current = track;
        captureUnderrunsAtStart = current == null ? 0 : current.getUnderrunCount();
        captureStallsAtStart = busStalls.get();
        captureStartedAtMs = System.currentTimeMillis();
        recorder = new PcmBusRecorder(file, SAMPLE_RATE, BLOCK_FRAMES);
    }

    void markCapture(String label) {
        PcmBusRecorder current = recorder;
        if (current != null) current.mark(label);
    }

    synchronized JSONObject stopCapture() throws IOException, JSONException {
        PcmBusRecorder current = recorder;
        if (current == null) return null;
        recorder = null;
        current.stop();
        AudioTrack output = track;
        JSONArray markers = new JSONArray();
        for (String marker : current.markers()) markers.put(marker);
        return new JSONObject()
            .put("file", current.file().getName())
            .put("sampleRate", SAMPLE_RATE)
            .put(
                "channels",
                new JSONArray()
                    .put("mixL").put("mixR")
                    .put("deck0L").put("deck0R")
                    .put("deck1L").put("deck1R")
            )
            .put("frames", current.capturedFrames())
            .put("droppedFrames", current.droppedFrames())
            .put(
                "underruns",
                output == null ? 0 : output.getUnderrunCount() - captureUnderrunsAtStart
            )
            .put("busStallPolls", busStalls.get() - captureStallsAtStart)
            .put("startedAtMs", captureStartedAtMs)
            .put("stoppedAtMs", System.currentTimeMillis())
            .put("markers", markers);
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
        return mixBlock(channels, mix, null, scratch, frames, blockStartFrame, 0L);
    }

    static int mixBlock(
        PcmBusChannel[] channels,
        float[] mix,
        float[][] taps,
        float[] scratch,
        int frames,
        long blockStartFrame
    ) {
        return mixBlock(channels, mix, taps, scratch, frames, blockStartFrame, 0L);
    }

    static int mixBlock(
        PcmBusChannel[] channels,
        float[] mix,
        float[][] taps,
        float[] scratch,
        int frames,
        long blockStartFrame,
        long nowMs
    ) {
        Arrays.fill(mix, 0, frames * CHANNELS, 0.0f);
        if (taps != null) {
            for (float[] tap : taps) Arrays.fill(tap, 0, frames * CHANNELS, 0.0f);
        }
        for (PcmBusChannel channel : channels) {
            if (channel.blocksMix(nowMs)) return 0;
        }
        int mixedFrames = 0;
        boolean scheduled = false;
        for (int index = 0; index < channels.length; index++) {
            PcmBusChannel channel = channels[index];
            scheduled |= channel.isScheduled();
            mixedFrames = Math.max(
                mixedFrames,
                channel.mixInto(
                    mix,
                    taps == null ? null : taps[index],
                    scratch,
                    frames,
                    blockStartFrame
                )
            );
        }
        if (mixedFrames == 0 && scheduled) return frames;
        return mixedFrames;
    }

    static boolean anyPlaying(PcmBusChannel[] channels) {
        for (PcmBusChannel channel : channels) {
            if (channel.isPlaying()) return true;
        }
        return false;
    }

    static long idleSleepMs(PcmBusChannel[] channels) {
        return anyPlaying(channels) ? 2L : 20L;
    }

    static boolean shouldPauseOutput(long idleSinceMs, long nowMs) {
        return idleSinceMs >= 0L && nowMs - idleSinceMs >= IDLE_PAUSE_MS;
    }

    static void toPcm16(float[] mix, short[] output, int samples) {
        for (int index = 0; index < samples; index++) {
            float sample = mix[index] * Short.MAX_VALUE;
            if (sample > Short.MAX_VALUE) sample = Short.MAX_VALUE;
            else if (sample < -Short.MAX_VALUE) sample = -Short.MAX_VALUE;
            output[index] = (short) (sample + (sample >= 0.0f ? 0.5f : -0.5f));
        }
    }

    synchronized void ensureStarted(int audioSessionId) {
        if (running) return;
        this.audioSessionId = audioSessionId;
        track = buildTrack();
        track.play();
        running = true;
        thread = new Thread(this::run, "crate-pcm-bus");
        thread.setPriority(Thread.MAX_PRIORITY);
        thread.start();
    }

    private AudioTrack buildTrack() {
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
        return builder.build();
    }

    // TEST_GAP: AudioTrack invalidation needs a real audio route change; covered by device testing.
    private synchronized boolean rebuildTrack() {
        if (!running) return false;
        if (track != null) track.release();
        track = buildTrack();
        track.play();
        Log.i(NativeMixAudioProcessor.QOE_TAG, "pcm bus output rebuilt");
        return true;
    }

    private void run() {
        float[] mix = new float[BLOCK_FRAMES * CHANNELS];
        float[] scratch = new float[BLOCK_FRAMES * CHANNELS];
        short[] output = new short[BLOCK_FRAMES * CHANNELS];
        float[][] taps = {
            new float[BLOCK_FRAMES * CHANNELS],
            new float[BLOCK_FRAMES * CHANNELS],
        };
        long idleSinceMs = -1L;
        while (running) {
            PcmBusRecorder activeRecorder = recorder;
            int frames = mixBlock(
                channels,
                mix,
                activeRecorder == null ? null : taps,
                scratch,
                BLOCK_FRAMES,
                busFrames.get(),
                SystemClock.elapsedRealtime()
            );
            busFrames.addAndGet(frames);
            if (frames == 0) {
                long nowMs = SystemClock.elapsedRealtime();
                if (anyPlaying(channels)) {
                    busStalls.incrementAndGet();
                    idleSinceMs = -1L;
                } else if (idleSinceMs < 0L) {
                    idleSinceMs = nowMs;
                }
                AudioTrack current = track;
                if (
                    shouldPauseOutput(idleSinceMs, nowMs) &&
                    current != null &&
                    current.getPlayState() == AudioTrack.PLAYSTATE_PLAYING
                ) {
                    current.pause();
                }
                try {
                    Thread.sleep(idleSleepMs(channels));
                } catch (InterruptedException error) {
                    return;
                }
                continue;
            }
            idleSinceMs = -1L;
            equalizer.process(mix, frames);
            toPcm16(mix, output, frames * CHANNELS);
            if (activeRecorder != null) activeRecorder.capture(output, taps[0], taps[1], frames);
            AudioTrack current = track;
            if (current == null) return;
            if (current.getPlayState() != AudioTrack.PLAYSTATE_PLAYING) current.play();
            int written = current.write(output, 0, frames * CHANNELS, AudioTrack.WRITE_BLOCKING);
            if (written == AudioTrack.ERROR_DEAD_OBJECT && rebuildTrack()) {
                written = track.write(output, 0, frames * CHANNELS, AudioTrack.WRITE_BLOCKING);
            }
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
