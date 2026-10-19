package app.cratemusic.crate;

import androidx.annotation.Nullable;
import androidx.media3.common.C;
import androidx.media3.common.audio.BaseAudioProcessor;
import androidx.media3.common.util.UnstableApi;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.ShortBuffer;

@UnstableApi
final class BusDownmixAudioProcessor extends BaseAudioProcessor {
    static final int MAX_INPUT_CHANNELS = 6;

    @Nullable
    private float[][] pendingCoefficients;
    @Nullable
    private float[][] coefficients;
    private short[] input = new short[0];

    @Override
    protected AudioFormat onConfigure(AudioFormat inputAudioFormat)
        throws UnhandledAudioFormatException {
        if (
            inputAudioFormat.encoding != C.ENCODING_PCM_16BIT ||
            inputAudioFormat.channelCount > MAX_INPUT_CHANNELS
        ) {
            throw new UnhandledAudioFormatException(inputAudioFormat);
        }
        if (inputAudioFormat.channelCount <= PcmBusMixer.CHANNELS) {
            pendingCoefficients = null;
            return AudioFormat.NOT_SET;
        }
        pendingCoefficients = normalizedCoefficients(inputAudioFormat.channelCount);
        return new AudioFormat(
            inputAudioFormat.sampleRate,
            PcmBusMixer.CHANNELS,
            C.ENCODING_PCM_16BIT
        );
    }

    static float[][] normalizedCoefficients(int inputChannels) {
        float[][] rows = stereoCoefficients(inputChannels);
        float loudestRow = 0.0f;
        for (float[] row : rows) {
            float sum = 0.0f;
            for (float coefficient : row) sum += coefficient;
            loudestRow = Math.max(loudestRow, sum);
        }
        for (float[] row : rows) {
            for (int in = 0; in < row.length; in++) row[in] /= loudestRow;
        }
        return rows;
    }

    private static float[][] stereoCoefficients(int inputChannels) {
        float half = 0.7071f;
        switch (inputChannels) {
            case 3:
                return new float[][] {
                    { 1.0f, 0.0f, half },
                    { 0.0f, 1.0f, half },
                };
            case 4:
                return new float[][] {
                    { 1.0f, 0.0f, half, 0.0f },
                    { 0.0f, 1.0f, 0.0f, half },
                };
            case 5:
                return new float[][] {
                    { 1.0f, 0.0f, half, half, 0.0f },
                    { 0.0f, 1.0f, half, 0.0f, half },
                };
            case 6:
                return new float[][] {
                    { 1.0f, 0.0f, half, 0.5f, half, 0.0f },
                    { 0.0f, 1.0f, half, 0.5f, 0.0f, half },
                };
            default:
                throw new IllegalArgumentException("Unsupported channel count " + inputChannels);
        }
    }

    @Override
    public void queueInput(ByteBuffer inputBuffer) {
        float[][] active = coefficients;
        int channels = inputAudioFormat.channelCount;
        int frames = inputBuffer.remaining() / (channels * 2);
        ByteBuffer output = replaceOutputBuffer(frames * PcmBusMixer.CHANNELS * 2)
            .order(ByteOrder.nativeOrder());
        if (active == null || frames == 0) {
            inputBuffer.position(inputBuffer.limit());
            output.flip();
            return;
        }
        int samples = frames * channels;
        if (input.length < samples) input = new short[samples];
        ShortBuffer source = inputBuffer.order(ByteOrder.nativeOrder()).asShortBuffer();
        source.get(input, 0, samples);
        inputBuffer.position(inputBuffer.limit());
        for (int frame = 0; frame < frames; frame++) {
            int base = frame * channels;
            for (int out = 0; out < PcmBusMixer.CHANNELS; out++) {
                float[] row = active[out];
                float sum = 0.0f;
                for (int in = 0; in < channels; in++) {
                    sum += input[base + in] * row[in];
                }
                if (sum > Short.MAX_VALUE) sum = Short.MAX_VALUE;
                else if (sum < Short.MIN_VALUE) sum = Short.MIN_VALUE;
                output.putShort((short) Math.round(sum));
            }
        }
        output.flip();
    }

    @Override
    protected void onFlush(StreamMetadata streamMetadata) {
        coefficients = pendingCoefficients;
    }

    @Override
    protected void onReset() {
        pendingCoefficients = null;
        coefficients = null;
    }
}
