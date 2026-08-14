package app.cratemusic.crate;

import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.BaseAudioProcessor;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.atomic.AtomicInteger;

final class NativeMixAudioProcessor extends BaseAudioProcessor {
    private final AtomicInteger requestedGainBits =
        new AtomicInteger(Float.floatToIntBits(1.0f));
    private final AtomicInteger requestedRampFrames = new AtomicInteger();
    private final AtomicInteger requestedRevision = new AtomicInteger();

    private int appliedRevision = -1;
    private float currentGain = 1.0f;
    private float targetGain = 1.0f;
    private int remainingRampFrames;

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
    }

    @Override
    protected void onFlush() {
        appliedRevision = -1;
        applyPendingTarget();
    }

    @Override
    protected void onReset() {
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

    private float gainForNextFrame() {
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
