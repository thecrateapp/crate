package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

import org.junit.Test;

public class NativeMixEnvelopeTest {
    private static final int SAMPLE_RATE = 1_000;
    private static final float STAGING_DB = -4.0103f;
    private static final float STAGING = (float) Math.pow(10.0, STAGING_DB / 20.0);

    @Test
    public void outgoingEnvelopeEasesIntoStagingAndFadesOutInFrames() throws Exception {
        NativeMixAudioProcessor processor = processor();
        processor.startEnvelope(NativeMixAudioProcessor.Role.OUTGOING, 1_000L, STAGING_DB);

        float[] samples = process(processor, 1_000);

        assertEquals(1.0f, samples[0], 0.001f);
        assertEquals((float) Math.cos(Math.PI / 4.0) * STAGING, samples[500], 0.002f);
        assertTrue(samples[999] < 0.005f);
        assertEquals(0.0f, process(processor, 10)[9], 0.0f);
    }

    @Test
    public void incomingEnvelopeReturnsToUnityWithoutAStep() throws Exception {
        NativeMixAudioProcessor processor = processor();
        processor.startEnvelope(NativeMixAudioProcessor.Role.INCOMING, 1_000L, STAGING_DB);

        float[] samples = process(processor, 1_000);
        float[] after = process(processor, 10);
        processor.clearEnvelope();
        float[] cleared = process(processor, 10);

        assertEquals(0.0f, samples[0], 0.001f);
        assertEquals((float) Math.sin(Math.PI / 4.0) * STAGING, samples[500], 0.002f);
        assertEquals(1.0f, samples[999], 0.005f);
        assertEquals(1.0f, after[0], 0.0f);
        assertEquals(1.0f, cleared[9], 0.0f);
        assertTrue(maximumStep(samples) < 0.005f);
    }

    @Test
    public void envelopeAdvancesByProcessedFramesAcrossUnevenBuffers() throws Exception {
        NativeMixAudioProcessor whole = processor();
        NativeMixAudioProcessor split = processor();
        whole.startEnvelope(NativeMixAudioProcessor.Role.INCOMING, 1_000L, STAGING_DB);
        split.startEnvelope(NativeMixAudioProcessor.Role.INCOMING, 1_000L, STAGING_DB);

        float[] expected = process(whole, 600);
        float[] first = process(split, 7);
        float[] second = process(split, 593);

        assertEquals(expected[6], first[6], 0.0f);
        assertEquals(expected[599], second[592], 0.0f);
        assertEquals(0.6f, split.envelopeProgress(), 0.001f);
    }

    @Test
    public void volumeChangesDuringTheEnvelopeDoNotRestartIt() throws Exception {
        NativeMixAudioProcessor processor = processor();
        processor.startEnvelope(NativeMixAudioProcessor.Role.OUTGOING, 1_000L, STAGING_DB);
        process(processor, 400);

        processor.setTargetGainFrames(0.5f, 10);
        float[] samples = process(processor, 200);

        assertEquals(0.6f, processor.envelopeProgress() - 0.0f, 0.001f);
        float expected = 0.5f * (float) Math.cos(0.599 * Math.PI / 2.0) * STAGING;
        assertEquals(expected, samples[199], 0.003f);
    }

    @Test
    public void clearingMidEnvelopeKeepsTheCurrentLevelAndRampsToTheBaseGain()
        throws Exception {
        NativeMixAudioProcessor processor = processor();
        processor.startEnvelope(NativeMixAudioProcessor.Role.OUTGOING, 1_000L, STAGING_DB);
        float[] before = process(processor, 500);

        processor.clearEnvelope();
        processor.setTargetGainFrames(1.0f, 50);
        float[] after = process(processor, 60);

        assertEquals(before[499], after[0], 0.003f);
        assertTrue(after[1] >= after[0]);
        assertEquals(1.0f, after[59], 0.0f);
    }

    private static NativeMixAudioProcessor processor() throws Exception {
        NativeMixAudioProcessor processor = new NativeMixAudioProcessor();
        processor.configure(
            new AudioProcessor.AudioFormat(SAMPLE_RATE, 1, C.ENCODING_PCM_FLOAT)
        );
        processor.flush();
        processor.setGainImmediate(1.0f);
        return processor;
    }

    private static float[] process(NativeMixAudioProcessor processor, int frames) {
        ByteBuffer input = ByteBuffer.allocateDirect(frames * 4).order(ByteOrder.nativeOrder());
        for (int frame = 0; frame < frames; frame++) {
            input.putFloat(1.0f);
        }
        input.flip();
        processor.queueInput(input);
        ByteBuffer output = processor.getOutput().order(ByteOrder.nativeOrder());
        float[] samples = new float[frames];
        for (int frame = 0; frame < frames; frame++) {
            samples[frame] = output.getFloat();
        }
        return samples;
    }

    private static float maximumStep(float[] samples) {
        float maximum = 0.0f;
        for (int index = 1; index < samples.length; index++) {
            maximum = Math.max(maximum, Math.abs(samples[index] - samples[index - 1]));
        }
        return maximum;
    }
}
