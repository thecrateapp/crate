package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

import org.junit.Test;

public class NativeMixAudioProcessorTest {
    @Test
    public void interpolatesGainAcrossPcmFramesWithoutAFirstSampleJump()
        throws Exception {
        NativeMixAudioProcessor processor = new NativeMixAudioProcessor();
        processor.configure(
            new AudioProcessor.AudioFormat(
                48_000,
                2,
                C.ENCODING_PCM_16BIT
            )
        );
        processor.flush();
        processor.setGainImmediate(1.0f);
        processor.setTargetGainFrames(0.0f, 4);

        processor.queueInput(constantPcm16(4, 2, (short) 10_000));
        ByteBuffer output = processor.getOutput().order(
            ByteOrder.nativeOrder()
        );

        short first = output.getShort();
        output.getShort();
        short second = output.getShort();
        output.getShort();
        short third = output.getShort();
        output.getShort();
        short last = output.getShort();

        assertEquals(10_000, first);
        assertTrue(first > second);
        assertTrue(second > third);
        assertTrue(third > last);
        assertEquals(0, last);
    }

    @Test
    public void reportsPeakAndClippingOnceWhenAnEnvelopeCompletes()
        throws Exception {
        NativeMixAudioProcessor processor = new NativeMixAudioProcessor();
        java.util.List<String> summaries = new java.util.ArrayList<>();
        processor.setEnvelopeReporter(summaries::add);
        processor.configure(
            new AudioProcessor.AudioFormat(1_000, 1, C.ENCODING_PCM_16BIT)
        );
        processor.flush();
        processor.startEnvelope(NativeMixAudioProcessor.Role.INCOMING, 4L, 0.0f);

        processor.queueInput(constantPcm16(4, 1, (short) 16_384));
        processor.getOutput();
        processor.queueInput(constantPcm16(4, 1, (short) 16_384));
        processor.getOutput();

        assertEquals(1, summaries.size());
        assertTrue(summaries.get(0).contains("role=INCOMING"));
        assertTrue(summaries.get(0).contains("clippedSamples=0"));
    }

    @Test
    public void clampsInvalidTargetsAndNeverOverflowsPcm16()
        throws Exception {
        NativeMixAudioProcessor processor = new NativeMixAudioProcessor();
        processor.configure(
            new AudioProcessor.AudioFormat(
                44_100,
                1,
                C.ENCODING_PCM_16BIT
            )
        );
        processor.flush();
        processor.setGainImmediate(Float.NaN);
        processor.setTargetGainFrames(4.0f, 1);

        processor.queueInput(
            constantPcm16(1, 1, Short.MAX_VALUE)
        );
        short output = processor.getOutput()
            .order(ByteOrder.nativeOrder())
            .getShort();

        assertEquals(Short.MAX_VALUE, output);
    }

    @Test
    public void passesUnityGainAudioThroughUnchanged() throws Exception {
        NativeMixAudioProcessor processor = new NativeMixAudioProcessor();
        processor.configure(
            new AudioProcessor.AudioFormat(48_000, 2, C.ENCODING_PCM_16BIT)
        );
        processor.flush();
        processor.setGainImmediate(1.0f);
        ByteBuffer input = constantPcm16(3, 2, (short) -1_234);

        processor.queueInput(input);
        ByteBuffer output = processor.getOutput().order(ByteOrder.nativeOrder());

        assertEquals(0, input.remaining());
        assertEquals(12, output.remaining());
        for (int index = 0; index < 6; index++) {
            assertEquals(-1_234, output.getShort());
        }
    }

    @Test
    public void anIncomingBassHandoffCutsTheBassBeforeTheSwap() throws Exception {
        NativeMixAudioProcessor processor = new NativeMixAudioProcessor();
        processor.configure(new AudioProcessor.AudioFormat(48_000, 1, C.ENCODING_PCM_16BIT));
        processor.flush();
        processor.setGainImmediate(1.0f);
        processor.startEnvelope(NativeMixAudioProcessor.Role.INCOMING, 10_000L, 0.0f, 0.5f);
        ByteBuffer input = ByteBuffer.allocateDirect(48_000 * 2).order(ByteOrder.nativeOrder());
        for (int frame = 0; frame < 48_000; frame++) {
            input.putShort((short) Math.round(8_000 * Math.sin(2.0 * Math.PI * 40 * frame / 48_000)));
        }
        input.flip();

        processor.queueInput(input);
        ByteBuffer output = processor.getOutput().order(ByteOrder.nativeOrder());

        double energy = 0.0;
        output.position(24_000 * 2);
        while (output.hasRemaining()) {
            short sample = output.getShort();
            energy += sample * (double) sample;
        }
        double rms = Math.sqrt(energy / 24_000);
        double envelopeGain = Math.sin(0.1 * Math.PI * 0.5);
        assertTrue("rms " + rms, rms < 8_000 * envelopeGain * 0.1);
    }

    private static ByteBuffer constantPcm16(
        int frames,
        int channels,
        short sample
    ) {
        ByteBuffer buffer = ByteBuffer.allocateDirect(
            frames * channels * 2
        ).order(ByteOrder.nativeOrder());
        for (int index = 0; index < frames * channels; index++) {
            buffer.putShort(sample);
        }
        buffer.flip();
        return buffer;
    }
}
