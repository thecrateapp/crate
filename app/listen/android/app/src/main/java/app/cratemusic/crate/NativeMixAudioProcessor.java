package app.cratemusic.crate;

import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.BaseAudioProcessor;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

final class NativeMixAudioProcessor extends BaseAudioProcessor {
    enum Role {
        OUTGOING,
        INCOMING
    }

    private static final class Envelope {
        final Role role;
        final long durationMs;
        final float stagingGain;

        Envelope(Role role, long durationMs, float stagingGain) {
            this.role = role;
            this.durationMs = durationMs;
            this.stagingGain = stagingGain;
        }
    }

    private static final Envelope NO_ENVELOPE = new Envelope(Role.INCOMING, 0L, 1.0f);

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
        float stagingGain = Float.isFinite(stagingGainDb)
            ? (float) Math.pow(10.0, Math.min(0.0f, stagingGainDb) / 20.0)
            : 1.0f;
        envelopeProgressBits.set(Float.floatToIntBits(0.0f));
        requestedEnvelope.set(new Envelope(role, Math.max(1L, durationMs), stagingGain));
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
                    float sample = inputBuffer.getFloat();
                    output.putFloat(clampFloat(sample * gain));
                }
            }
        } else {
            while (inputBuffer.remaining() >= channelCount * 2) {
                float gain = gainForNextFrame();
                for (int channel = 0; channel < channelCount; channel++) {
                    int sample = inputBuffer.getShort();
                    output.putShort(clampPcm16(Math.round(sample * gain)));
                }
            }
        }
        inputBuffer.position(inputBuffer.limit());
        output.flip();
        if (activeEnvelope != NO_ENVELOPE) {
            envelopeProgressBits.set(
                Float.floatToIntBits(Math.min(1.0f, envelopeFrame / (float) envelopeFrames))
            );
        }
    }

    @Override
    protected void onFlush() {
        appliedRevision = -1;
        applyPendingTarget();
    }

    @Override
    protected void onReset() {
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
        if (requested == NO_ENVELOPE) {
            currentGain *= envelopeFactor;
            targetGain *= envelopeFactor;
            envelopeFactor = 1.0f;
            activeEnvelope = NO_ENVELOPE;
            return;
        }
        int sampleRate = Math.max(1, inputAudioFormat.sampleRate);
        activeEnvelope = requested;
        envelopeFrame = 0L;
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
        envelopeFactor = activeEnvelope.role == Role.OUTGOING
            ? equalPowerOutgoing(progress) * staging(activeEnvelope.stagingGain, easeIn(progress))
            : equalPowerIncoming(progress) * staging(activeEnvelope.stagingGain, easeOut(progress));
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
