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
