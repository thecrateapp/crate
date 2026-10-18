package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class PcmBusTest {
    private static float[] frames(float... samples) {
        return samples;
    }

    @Test
    public void ringBufferWrapsAndRespectsCapacity() {
        PcmRingBuffer buffer = new PcmRingBuffer(3, 2);
        float[] out = new float[6];

        assertEquals(3, buffer.write(frames(1, 1, 2, 2, 3, 3, 4, 4), 4));
        assertEquals(2, buffer.read(out, 2));
        assertEquals(2, buffer.write(frames(5, 5, 6, 6), 2));
        assertEquals(3, buffer.read(out, 5));

        assertEquals(3.0f, out[0], 0.0f);
        assertEquals(5.0f, out[2], 0.0f);
        assertEquals(6.0f, out[4], 0.0f);
        assertEquals(0, buffer.availableFrames());
    }

    @Test
    public void clearDropsBufferedFrames() {
        PcmRingBuffer buffer = new PcmRingBuffer(4, 2);
        buffer.write(frames(1, 1, 2, 2), 2);

        buffer.clear();

        assertEquals(0, buffer.availableFrames());
        assertEquals(4, buffer.writableFrames());
    }

    @Test
    public void aChannelOnlyAdvancesItsClockWhilePlaying() {
        PcmBusChannel channel = new PcmBusChannel(8);
        channel.buffer().write(frames(0.5f, 0.5f, 0.5f, 0.5f), 2);
        float[] mix = new float[4];
        float[] scratch = new float[4];

        assertEquals(0, channel.mixInto(mix, scratch, 2));
        assertEquals(0L, channel.consumedFrames());

        channel.setPlaying(true);
        channel.setVolume(0.5f);
        assertEquals(2, channel.mixInto(mix, scratch, 2));

        assertEquals(2L, channel.consumedFrames());
        assertEquals(0.25f, mix[0], 0.0001f);
        channel.flush();
        assertEquals(0L, channel.consumedFrames());
    }

    @Test
    public void theMixerSumsBothDecksAndClampsTheOutput() {
        PcmBusChannel outgoing = new PcmBusChannel(8);
        PcmBusChannel incoming = new PcmBusChannel(8);
        outgoing.buffer().write(frames(0.4f, 0.4f, 0.8f, 0.8f), 2);
        incoming.buffer().write(frames(0.3f, 0.3f), 1);
        outgoing.setPlaying(true);
        incoming.setPlaying(true);
        float[] mix = new float[4];
        float[] scratch = new float[4];

        int frames = PcmBusMixer.mixBlock(
            new PcmBusChannel[] { outgoing, incoming },
            mix,
            scratch,
            2
        );

        assertEquals(2, frames);
        assertEquals(0.7f, mix[0], 0.0001f);
        assertEquals(0.8f, mix[2], 0.0001f);
        assertEquals(2L, outgoing.consumedFrames());
        assertEquals(1L, incoming.consumedFrames());
    }
}
