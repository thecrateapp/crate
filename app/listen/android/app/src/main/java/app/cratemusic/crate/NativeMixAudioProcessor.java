package app.cratemusic.crate;

import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.BaseAudioProcessor;
import androidx.media3.common.util.UnstableApi;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.ShortBuffer;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

@OptIn(markerClass = UnstableApi.class)
final class NativeMixAudioProcessor extends BaseAudioProcessor {
    private short[] pcm16Scratch = new short[0];
    enum Role {
        OUTGOING,
        INCOMING
    }

    private static final class Envelope {
        final Role role;
        final long durationMs;
        final float stagingGain;
        final float bassHandoffAt;
        final boolean djBlend;

        Envelope(
            Role role,
            long durationMs,
            float stagingGain,
            float bassHandoffAt,
            boolean djBlend
        ) {
            this.role = role;
            this.durationMs = durationMs;
            this.stagingGain = stagingGain;
            this.bassHandoffAt = bassHandoffAt;
            this.djBlend = djBlend;
        }
    }

    static final String QOE_TAG = "CrateSmartMixQoE";

    interface EnvelopeReporter {
        void report(String summary);
    }

    private volatile EnvelopeReporter envelopeReporter;
    private static final Envelope NO_ENVELOPE = new Envelope(Role.INCOMING, 0L, 1.0f, Float.NaN, false);

    private final BassHandoffFilter bassFilter = new BassHandoffFilter();

    private final AtomicReference<Envelope> requestedEnvelope =
        new AtomicReference<>(NO_ENVELOPE);
    private final AtomicInteger envelopeProgressBits =
        new AtomicInteger(Float.floatToIntBits(0.0f));
    private final AtomicInteger requestedGainBits =
        new AtomicInteger(Float.floatToIntBits(1.0f));
    private final AtomicInteger requestedRampFrames = new AtomicInteger();
    private final AtomicInteger requestedRevision = new AtomicInteger();

    private int appliedRevision = -1;
    private float currentGain = 1.0f;
    private float targetGain = 1.0f;
    private int remainingRampFrames;
    private Envelope activeEnvelope = NO_ENVELOPE;
    private long envelopeFrame;
    private long envelopeFrames;
    private float envelopeFactor = 1.0f;
    private float envelopePeak;
    private long envelopeClippedSamples;
    private boolean envelopeReported = true;

    void setGainImmediately(float gain) {
        requestGain(gain, 0);
    }

    void setGainImmediate(float gain) {
        setGainImmediately(gain);
    }

    void setTargetGain(float gain, int rampFrames) {
        requestGain(gain, Math.max(1, rampFrames));
    }

    void setTargetGainFrames(float gain, int rampFrames) {
        setTargetGain(gain, rampFrames);
    }

    void setTargetGain(float gain) {
        int sampleRate = inputAudioFormat.sampleRate;
        int rampFrames = sampleRate > 0
            ? Math.max(1, sampleRate / 100)
            : 480;
        setTargetGain(gain, rampFrames);
    }

    void startEnvelope(Role role, long durationMs, float stagingGainDb) {
        startEnvelope(role, durationMs, stagingGainDb, Float.NaN);
    }

    void startEnvelope(Role role, long durationMs, float stagingGainDb, float bassHandoffAt) {
        startEnvelope(role, durationMs, stagingGainDb, bassHandoffAt, false);
    }

    void startEnvelope(
        Role role,
        long durationMs,
        float stagingGainDb,
        float bassHandoffAt,
        boolean djBlend
    ) {
        float stagingGain = Float.isFinite(stagingGainDb)
            ? (float) Math.pow(10.0, Math.min(0.0f, stagingGainDb) / 20.0)
            : 1.0f;
        envelopeProgressBits.set(Float.floatToIntBits(0.0f));
        requestedEnvelope.set(
            new Envelope(role, Math.max(1L, durationMs), stagingGain, bassHandoffAt, djBlend)
        );
    }

    void clearEnvelope() {
        requestedEnvelope.set(NO_ENVELOPE);
    }

    float envelopeProgress() {
        return Float.intBitsToFloat(envelopeProgressBits.get());
    }

    @Override
    protected AudioFormat onConfigure(AudioFormat inputFormat)
        throws UnhandledAudioFormatException {
        if (
            inputFormat.encoding != C.ENCODING_PCM_16BIT &&
            inputFormat.encoding != C.ENCODING_PCM_FLOAT
        ) {
            throw new UnhandledAudioFormatException(inputFormat);
        }
        return inputFormat;
    }

    @Override
    public void queueInput(ByteBuffer inputBuffer) {
        applyPendingEnvelope();
        applyPendingTarget();
        ByteBuffer output = replaceOutputBuffer(inputBuffer.remaining())
            .order(ByteOrder.nativeOrder());
        int channelCount = Math.max(1, inputAudioFormat.channelCount);

        if (inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT) {
            while (inputBuffer.remaining() >= channelCount * 4) {
                float gain = gainForNextFrame();
                for (int channel = 0; channel < channelCount; channel++) {
                    float sample = inputBuffer.getFloat() * gain;
                    trackEnvelopeLevel(Math.abs(sample));
                    output.putFloat(clampFloat(sample));
                }
            }
        } else if (isUnityGain()) {
            int bytes = inputBuffer.remaining() - inputBuffer.remaining() % (channelCount * 2);
            ByteBuffer frames = inputBuffer.slice();
            frames.limit(bytes);
            output.put(frames);
        } else {
            ShortBuffer input = inputBuffer.order(ByteOrder.nativeOrder()).asShortBuffer();
            int samples = input.remaining() - input.remaining() % channelCount;
            if (pcm16Scratch.length < samples) pcm16Scratch = new short[samples];
            input.get(pcm16Scratch, 0, samples);
            boolean trackLevel = activeEnvelope != NO_ENVELOPE;
            long envelopeStartFrame = envelopeFrame;
            for (int index = 0; index < samples; index += channelCount) {
                float gain = gainForNextFrame();
                for (int channel = 0; channel < channelCount; channel++) {
                    int sample = Math.round(pcm16Scratch[index + channel] * gain);
                    if (trackLevel) trackEnvelopeLevel(Math.abs(sample) / (float) Short.MAX_VALUE);
                    pcm16Scratch[index + channel] = clampPcm16(sample);
                }
            }
            if (trackLevel && !Float.isNaN(activeEnvelope.bassHandoffAt)) {
                bassFilter.process(
                    pcm16Scratch,
                    samples / channelCount,
                    envelopeStartFrame,
                    envelopeFrames,
                    activeEnvelope.role,
                    activeEnvelope.bassHandoffAt
                );
            } else if (bassFilter.isReleasing()) {
                bassFilter.processRelease(pcm16Scratch, samples / channelCount);
            }
            output.asShortBuffer().put(pcm16Scratch, 0, samples);
            output.position(samples * 2);
        }
        inputBuffer.position(inputBuffer.limit());
        output.flip();
        if (activeEnvelope != NO_ENVELOPE) {
            envelopeProgressBits.set(
                Float.floatToIntBits(Math.min(1.0f, envelopeFrame / (float) envelopeFrames))
            );
            if (envelopeFrame >= envelopeFrames) {
                reportEnvelope();
            }
        }
    }

    private String bassSummary() {
        if (Float.isNaN(activeEnvelope.bassHandoffAt)) return " bass=none";
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT) return " bass=unsupported";
        return " bassAt=" + activeEnvelope.bassHandoffAt + " " + bassFilter.summary();
    }

    private boolean isUnityGain() {
        return (
            activeEnvelope == NO_ENVELOPE &&
            remainingRampFrames == 0 &&
            currentGain == 1.0f &&
            !bassFilter.isReleasing()
        );
    }

    void setEnvelopeReporter(EnvelopeReporter reporter) {
        envelopeReporter = reporter;
    }

    private void reportEnvelope() {
        if (envelopeReported || activeEnvelope == NO_ENVELOPE) {
            return;
        }
        envelopeReported = true;
        EnvelopeReporter reporter = envelopeReporter;
        if (reporter == null) {
            return;
        }
        reporter.report(
            "envelope role=" + activeEnvelope.role
                + " durationMs=" + activeEnvelope.durationMs
                + " progress=" + Math.min(1.0f, envelopeFrame / (float) envelopeFrames)
                + " stagingGain=" + activeEnvelope.stagingGain
                + " peak=" + envelopePeak
                + " clippedSamples=" + envelopeClippedSamples
                + bassSummary()
        );
    }

    @Override
    protected void onQueueEndOfStream() {
        reportEnvelope();
    }

    private void trackEnvelopeLevel(float level) {
        if (activeEnvelope == NO_ENVELOPE) {
            return;
        }
        if (level > envelopePeak) {
            envelopePeak = level;
        }
        if (level > 1.0f) {
            envelopeClippedSamples++;
        }
    }

    @Override
    protected void onFlush() {
        reportEnvelope();
        bassFilter.configure(inputAudioFormat.sampleRate, inputAudioFormat.channelCount);
        appliedRevision = -1;
        applyPendingTarget();
    }

    @Override
    protected void onReset() {
        reportEnvelope();
        activeEnvelope = NO_ENVELOPE;
        envelopeFactor = 1.0f;
        requestedEnvelope.set(NO_ENVELOPE);
        currentGain = 1.0f;
        targetGain = 1.0f;
        remainingRampFrames = 0;
        appliedRevision = -1;
        requestedGainBits.set(Float.floatToIntBits(1.0f));
        requestedRampFrames.set(0);
        requestedRevision.incrementAndGet();
    }

    static final float DJ_BLEND_ENTRY = 0.3f;
    static final float DJ_BLEND_EXIT = 0.7f;

    static float djBlendProgress(float progress) {
        float safeProgress = clampUnit(progress);
        if (safeProgress <= DJ_BLEND_ENTRY) {
            return 0.5f * smoothstep(safeProgress / DJ_BLEND_ENTRY);
        }
        if (safeProgress < DJ_BLEND_EXIT) {
            return 0.5f;
        }
        return 0.5f + 0.5f * smoothstep((safeProgress - DJ_BLEND_EXIT) / (1.0f - DJ_BLEND_EXIT));
    }

    private static float smoothstep(float value) {
        float x = Math.max(0.0f, Math.min(1.0f, value));
        return x * x * (3.0f - 2.0f * x);
    }

    static float equalPowerOutgoing(float progress) {
        float safeProgress = clampUnit(progress);
        if (safeProgress >= 1.0f) {
            return 0.0f;
        }
        return (float) Math.cos(safeProgress * Math.PI * 0.5);
    }

    static float equalPowerIncoming(float progress) {
        float safeProgress = clampUnit(progress);
        return (float) Math.sin(safeProgress * Math.PI * 0.5);
    }

    private void requestGain(float gain, int rampFrames) {
        requestedGainBits.set(
            Float.floatToIntBits(clampUnit(gain))
        );
        requestedRampFrames.set(Math.max(0, rampFrames));
        requestedRevision.incrementAndGet();
    }

    private void applyPendingTarget() {
        int revision = requestedRevision.get();
        if (revision == appliedRevision) {
            return;
        }
        targetGain = Float.intBitsToFloat(requestedGainBits.get());
        remainingRampFrames = requestedRampFrames.get();
        if (remainingRampFrames == 0) {
            currentGain = targetGain;
        }
        appliedRevision = revision;
    }

    private void applyPendingEnvelope() {
        Envelope requested = requestedEnvelope.get();
        if (requested == activeEnvelope) {
            return;
        }
        reportEnvelope();
        if (requested == NO_ENVELOPE) {
            bassFilter.release();
            currentGain *= envelopeFactor;
            targetGain *= envelopeFactor;
            envelopeFactor = 1.0f;
            activeEnvelope = NO_ENVELOPE;
            return;
        }
        bassFilter.reset();
        int sampleRate = Math.max(1, inputAudioFormat.sampleRate);
        activeEnvelope = requested;
        envelopeFrame = 0L;
        envelopePeak = 0.0f;
        envelopeClippedSamples = 0L;
        envelopeReported = false;
        envelopeFrames = Math.max(1L, requested.durationMs * sampleRate / 1_000L);
    }

    private float gainForNextFrame() {
        return baseGainForNextFrame() * envelopeFactorForNextFrame();
    }

    private float envelopeFactorForNextFrame() {
        if (activeEnvelope == NO_ENVELOPE) {
            return 1.0f;
        }
        float progress = Math.min(1.0f, envelopeFrame / (float) envelopeFrames);
        if (envelopeFrame < envelopeFrames) {
            envelopeFrame++;
        }
        float crossfade = activeEnvelope.djBlend ? djBlendProgress(progress) : progress;
        envelopeFactor = activeEnvelope.role == Role.OUTGOING
            ? equalPowerOutgoing(crossfade) * staging(activeEnvelope.stagingGain, easeIn(progress))
            : equalPowerIncoming(crossfade) * staging(activeEnvelope.stagingGain, easeOut(progress));
        return envelopeFactor;
    }

    private static float staging(float stagingGain, float weight) {
        return 1.0f + (stagingGain - 1.0f) * weight;
    }

    private static float easeIn(float progress) {
        if (progress >= 0.5f) {
            return 1.0f;
        }
        return (float) (0.5 - 0.5 * Math.cos(Math.PI * progress / 0.5));
    }

    private static float easeOut(float progress) {
        if (progress <= 0.5f) {
            return 1.0f;
        }
        return (float) (0.5 + 0.5 * Math.cos(Math.PI * (progress - 0.5f) / 0.5));
    }

    private float baseGainForNextFrame() {
        float gain = currentGain;
        if (remainingRampFrames > 1) {
            remainingRampFrames--;
            currentGain +=
                (targetGain - currentGain) / remainingRampFrames;
        } else if (remainingRampFrames == 1) {
            remainingRampFrames = 0;
            currentGain = targetGain;
        }
        return gain;
    }

    private static short clampPcm16(int sample) {
        return (short) Math.max(
            Short.MIN_VALUE,
            Math.min(Short.MAX_VALUE, sample)
        );
    }

    private static float clampFloat(float sample) {
        if (!Float.isFinite(sample)) {
            return 0.0f;
        }
        return Math.max(-1.0f, Math.min(1.0f, sample));
    }

    private static float clampUnit(float value) {
        if (!Float.isFinite(value)) {
            return 1.0f;
        }
        return Math.max(0.0f, Math.min(1.0f, value));
    }
}
