package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.AudioProcessor.AudioFormat;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

import org.junit.Test;

public class PcmBusAudioProcessorsTest {
    private static AudioProcessor downmix() {
        return PcmBusAudioOutputProvider.busAudioProcessors(new NativeMixAudioProcessor())[0];
    }

    @Test
    public void downmixesFivePointOneToStereo() throws Exception {
        AudioProcessor downmix = downmix();

        AudioFormat output = downmix.configure(new AudioFormat(48_000, 6, C.ENCODING_PCM_16BIT));

        assertTrue(downmix.isActive());
        assertEquals(2, output.channelCount);
    }

    @Test
    public void keepsTheCenterChannelInTheDownmix() throws Exception {
        AudioProcessor downmix = downmix();
        downmix.configure(new AudioFormat(48_000, 6, C.ENCODING_PCM_16BIT));
        downmix.flush(AudioProcessor.StreamMetadata.DEFAULT);
        ByteBuffer frame = ByteBuffer.allocateDirect(12).order(ByteOrder.nativeOrder());
        frame.putShort((short) 0).putShort((short) 0).putShort((short) 10_000)
            .putShort((short) 0).putShort((short) 0).putShort((short) 0);
        frame.flip();

        downmix.queueInput(frame);
        ByteBuffer output = downmix.getOutput().order(ByteOrder.nativeOrder());

        short left = output.getShort();
        short right = output.getShort();
        assertTrue(left > 0);
        assertEquals(left, right);
    }

    @Test
    public void leavesStereoUntouched() throws Exception {
        AudioProcessor downmix = downmix();

        downmix.configure(new AudioFormat(48_000, 2, C.ENCODING_PCM_16BIT));

        assertFalse(downmix.isActive());
    }

    @Test
    public void leavesMonoForTheBusOutputToSpread() throws Exception {
        AudioProcessor downmix = downmix();

        downmix.configure(new AudioFormat(48_000, 1, C.ENCODING_PCM_16BIT));

        assertFalse(downmix.isActive());
    }

    @Test
    public void frontChannelsStayOnTheirSide() {
        float[][] rows = BusDownmixAudioProcessor.normalizedCoefficients(6);

        assertTrue(rows[0][0] > 0.0f);
        assertEquals(0.0f, rows[1][0], 0.0f);
        assertTrue(rows[1][1] > 0.0f);
        assertEquals(0.0f, rows[0][1], 0.0f);
    }

    @Test
    public void theDownmixNeverAddsGain() {
        for (int channels = 3; channels <= BusDownmixAudioProcessor.MAX_INPUT_CHANNELS; channels++) {
            for (float[] row : BusDownmixAudioProcessor.normalizedCoefficients(channels)) {
                float sum = 0.0f;
                for (float coefficient : row) sum += coefficient;
                assertTrue(sum <= 1.0001f);
            }
        }
    }

    @Test(expected = AudioProcessor.UnhandledAudioFormatException.class)
    public void rejectsMoreThanFivePointOne() throws Exception {
        downmix().configure(new AudioFormat(48_000, 8, C.ENCODING_PCM_16BIT));
    }
}
