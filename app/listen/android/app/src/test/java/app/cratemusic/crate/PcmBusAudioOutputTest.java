package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import androidx.media3.common.C;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

import org.junit.Test;

public class PcmBusAudioOutputTest {
    private static ByteBuffer pcm16(short... samples) {
        ByteBuffer buffer = ByteBuffer.allocateDirect(samples.length * 2)
            .order(ByteOrder.LITTLE_ENDIAN);
        for (short sample : samples) buffer.putShort(sample);
        buffer.flip();
        return buffer;
    }

    private static float[] written(PcmBusChannel channel, int frames) {
        float[] samples = new float[frames * PcmBusMixer.CHANNELS];
        channel.buffer().read(samples, frames);
        return samples;
    }

    @Test
    public void writesStereoPcm16AsFloatFrames() {
        PcmBusMixer mixer = new PcmBusMixer();
        PcmBusAudioOutput output = new PcmBusAudioOutput(
            mixer.channel(0), mixer, C.ENCODING_PCM_16BIT, 2, 48_000, 0
        );
        ByteBuffer buffer = pcm16((short) 16_384, (short) -16_384, (short) 0, (short) 8_192);

        assertTrue(output.write(buffer, 1, 0L));

        float[] samples = written(mixer.channel(0), 2);
        assertEquals(0, buffer.remaining());
        assertEquals(0.5f, samples[0], 0.0f);
        assertEquals(-0.5f, samples[1], 0.0f);
        assertEquals(0.0f, samples[2], 0.0f);
        assertEquals(0.25f, samples[3], 0.0f);
    }

    @Test
    public void duplicatesMonoPcm16IntoBothBusChannels() {
        PcmBusMixer mixer = new PcmBusMixer();
        PcmBusAudioOutput output = new PcmBusAudioOutput(
            mixer.channel(1), mixer, C.ENCODING_PCM_16BIT, 1, 48_000, 0
        );

        assertTrue(output.write(pcm16((short) 16_384, (short) -8_192), 1, 0L));

        float[] samples = written(mixer.channel(1), 2);
        assertEquals(0.5f, samples[0], 0.0f);
        assertEquals(0.5f, samples[1], 0.0f);
        assertEquals(-0.25f, samples[2], 0.0f);
        assertEquals(-0.25f, samples[3], 0.0f);
    }

    @Test
    public void stopsWritingWhenTheRingIsFull() {
        PcmBusMixer mixer = new PcmBusMixer();
        PcmBusChannel channel = mixer.channel(0);
        channel.write(new float[channel.buffer().capacityFrames() * 2 - 2], channel.buffer().capacityFrames() - 1);
        PcmBusAudioOutput output = new PcmBusAudioOutput(
            channel, mixer, C.ENCODING_PCM_16BIT, 2, 48_000, 0
        );
        ByteBuffer buffer = pcm16((short) 1, (short) 1, (short) 2, (short) 2);

        assertEquals(false, output.write(buffer, 1, 0L));

        assertEquals(4, buffer.remaining());
    }
}
