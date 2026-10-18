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

        assertEquals(0, channel.mixInto(mix, scratch, 2, 0L));
        assertEquals(0L, channel.consumedFrames());

        channel.setPlaying(true);
        channel.setVolume(0.5f);
        assertEquals(2, channel.mixInto(mix, scratch, 2, 0L));

        assertEquals(2L, channel.consumedFrames());
        assertEquals(0.25f, mix[0], 0.0001f);
        channel.flush();
        assertEquals(0L, channel.consumedFrames());
    }

    @Test
    public void theMixerSumsBothDecks() {
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
            2,
            0L
        );

        assertEquals(2, frames);
        assertEquals(0.7f, mix[0], 0.0001f);
        assertEquals(0.8f, mix[2], 0.0001f);
        assertEquals(2L, outgoing.consumedFrames());
        assertEquals(1L, incoming.consumedFrames());
    }

    @Test
    public void theMixerWaitsForAPlayingChannelUntilItEnds() {
        PcmBusChannel outgoing = new PcmBusChannel(8);
        PcmBusChannel incoming = new PcmBusChannel(8);
        outgoing.write(frames(0.4f, 0.4f, 0.4f, 0.4f), 2);
        outgoing.setPlaying(true);
        incoming.setPlaying(true);
        float[] mix = new float[4];
        float[] scratch = new float[4];
        PcmBusChannel[] channels = { outgoing, incoming };

        assertEquals(1, PcmBusMixer.mixBlock(channels, mix, scratch, 1, 0L));

        incoming.write(frames(0.2f, 0.2f), 1);
        PcmBusMixer.mixBlock(channels, mix, scratch, 1, 0L);
        assertEquals(0, PcmBusMixer.mixBlock(channels, mix, scratch, 1, 0L));

        incoming.markEndOfStream();
        assertEquals(0, PcmBusMixer.mixBlock(channels, mix, scratch, 1, 0L));
    }

    @Test
    public void aHeldChannelNeitherPlaysNorStallsTheBus() {
        PcmBusChannel outgoing = new PcmBusChannel(8);
        PcmBusChannel incoming = new PcmBusChannel(8);
        outgoing.write(frames(0.4f, 0.4f, 0.4f, 0.4f), 2);
        outgoing.setPlaying(true);
        incoming.hold();
        incoming.setPlaying(true);
        incoming.write(frames(0.2f, 0.2f), 1);
        PcmBusChannel[] channels = { outgoing, incoming };
        float[] mix = new float[4];
        float[] scratch = new float[4];

        assertEquals(2, PcmBusMixer.mixBlock(channels, mix, scratch, 2, 0L));

        assertEquals(0.4f, mix[2], 0.0001f);
        assertEquals(0L, incoming.consumedFrames());
    }

    @Test
    public void aScheduledChannelStartsOnItsExactBusFrame() {
        PcmBusChannel channel = new PcmBusChannel(8);
        channel.hold();
        channel.setPlaying(true);
        channel.write(frames(0.1f, 0.1f, 0.2f, 0.2f, 0.3f, 0.3f), 3);
        channel.startAt(102L);
        float[] mix = new float[8];
        float[] scratch = new float[8];

        assertEquals(0, channel.mixInto(mix, scratch, 2, 100L));
        assertEquals(4, channel.mixInto(mix, scratch, 4, 100L));

        assertEquals(0.0f, mix[2], 0.0f);
        assertEquals(0.1f, mix[4], 0.0001f);
        assertEquals(0.2f, mix[6], 0.0001f);
        assertEquals(2L, channel.consumedFrames());
    }

    @Test
    public void aLateScheduledStartSkipsTheFramesItMissed() {
        PcmBusChannel channel = new PcmBusChannel(8);
        channel.hold();
        channel.setPlaying(true);
        channel.write(frames(0.1f, 0.1f, 0.2f, 0.2f, 0.3f, 0.3f), 3);
        channel.startAt(98L);
        float[] mix = new float[2];
        float[] scratch = new float[2];

        assertEquals(1, channel.mixInto(mix, scratch, 1, 100L));

        assertEquals(0.3f, mix[0], 0.0001f);
        assertEquals(3L, channel.consumedFrames());
    }

    @Test
    public void reschedulingNeverRestartsAChannelThatAlreadyStarted() {
        PcmBusChannel channel = new PcmBusChannel(8);
        channel.hold();
        channel.setPlaying(true);
        channel.write(frames(0.1f, 0.1f, 0.2f, 0.2f), 2);
        channel.startAt(0L);
        float[] mix = new float[2];
        float[] scratch = new float[2];
        channel.mixInto(mix, scratch, 1, 0L);

        channel.startAt(50L);

        assertEquals(1, channel.mixInto(mix, scratch, 1, 1L));
    }

    @Test
    public void theBusClockRunsWhileAChannelWaitsForItsStart() {
        PcmBusChannel channel = new PcmBusChannel(8);
        channel.hold();
        channel.setPlaying(true);
        channel.write(frames(0.1f, 0.1f), 1);
        PcmBusChannel[] channels = { channel };
        float[] mix = new float[4];
        float[] scratch = new float[4];

        assertEquals(0, PcmBusMixer.mixBlock(channels, mix, scratch, 2, 0L));

        channel.startAt(10L);
        assertEquals(2, PcmBusMixer.mixBlock(channels, mix, scratch, 2, 0L));
        assertEquals(0L, channel.consumedFrames());
    }

    @Test
    public void theBusOutputIsClampedSixteenBitPcm() {
        short[] output = new short[3];

        PcmBusMixer.toPcm16(frames(1.5f, -1.0f, 0.5f), output, 3);

        assertEquals(Short.MAX_VALUE, output[0]);
        assertEquals(-Short.MAX_VALUE, output[1]);
        assertEquals(16384, output[2]);
    }

    @Test
    public void anIdleBusPollsLessOftenThanAStarvedOne() {
        PcmBusChannel first = new PcmBusChannel(8);
        PcmBusChannel second = new PcmBusChannel(8);
        PcmBusChannel[] channels = { first, second };

        assertEquals(20L, PcmBusMixer.idleSleepMs(channels));

        second.setPlaying(true);
        assertEquals(2L, PcmBusMixer.idleSleepMs(channels));
    }
}
