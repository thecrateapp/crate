package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class PcmBusRecorderTest {
    @Rule
    public TemporaryFolder folder = new TemporaryFolder();

    @Test
    public void writesTheMixAndBothDecksAsASixChannelWave() throws Exception {
        File file = folder.newFile("capture.wav");
        PcmBusRecorder recorder = new PcmBusRecorder(file, 48_000, 2);

        recorder.capture(
            new short[] { 100, -100, 200, -200 },
            new float[] { 0.5f, -0.5f, 0.25f, -0.25f },
            new float[] { 0.0f, 0.0f, 1.0f, -1.0f },
            2
        );
        recorder.mark("start a>b");
        recorder.stop();

        ByteBuffer wav = ByteBuffer.wrap(Files.readAllBytes(file.toPath()))
            .order(ByteOrder.LITTLE_ENDIAN);
        assertEquals(44 + 2 * 6 * 2, wav.capacity());
        assertEquals(6, wav.getShort(22));
        assertEquals(48_000, wav.getInt(24));
        assertEquals(2 * 6 * 2, wav.getInt(40));
        assertEquals(100, wav.getShort(44));
        assertEquals(-100, wav.getShort(46));
        assertEquals(16_384, wav.getShort(48));
        assertEquals(-16_384, wav.getShort(50));
        assertEquals(Short.MAX_VALUE, wav.getShort(44 + 12 + 8));
        assertEquals(-Short.MAX_VALUE, wav.getShort(44 + 12 + 10));
        assertEquals("2:start a>b", recorder.markers().get(0));
        assertEquals(2L, recorder.capturedFrames());
    }

    @Test
    public void dropsBlocksInsteadOfBlockingWhenThePoolIsExhausted() throws Exception {
        File file = folder.newFile("busy.wav");
        PcmBusRecorder recorder = new PcmBusRecorder(file, 48_000, 1);
        short[] mix = new short[2];
        float[] deck = new float[2];

        for (int index = 0; index < PcmBusRecorder.POOL_BLOCKS * 4; index++) {
            recorder.capture(mix, deck, deck, 1);
        }
        recorder.stop();

        assertEquals(
            PcmBusRecorder.POOL_BLOCKS * 4L,
            recorder.capturedFrames() + recorder.droppedFrames()
        );
        assertTrue(recorder.capturedFrames() >= PcmBusRecorder.POOL_BLOCKS);
    }

    @Test
    public void tapsCarryEachDeckBeforeTheMixIsSummed() {
        PcmBusChannel first = new PcmBusChannel(8);
        PcmBusChannel second = new PcmBusChannel(8);
        first.write(new float[] { 0.25f, 0.25f }, 1);
        second.write(new float[] { 0.5f, 0.5f }, 1);
        first.setPlaying(true);
        second.setPlaying(true);
        second.setVolume(0.5f);
        float[] mix = new float[2];
        float[][] taps = { new float[2], new float[2] };

        PcmBusMixer.mixBlock(new PcmBusChannel[] { first, second }, mix, taps, new float[2], 1, 0L);

        assertEquals(0.5f, mix[0], 0.0001f);
        assertEquals(0.25f, taps[0][0], 0.0001f);
        assertEquals(0.25f, taps[1][0], 0.0001f);
    }

    @Test
    public void captureSummaryCarriesTheWallClockSpanToDetectGaps() throws Exception {
        PcmBusMixer mixer = new PcmBusMixer();
        mixer.startCapture(folder.newFile("span.wav"));
        Thread.sleep(5L);

        org.json.JSONObject summary = mixer.stopCapture();

        assertEquals(0L, summary.getLong("frames"));
        assertTrue(summary.getLong("stoppedAtMs") >= summary.getLong("startedAtMs") + 5L);
    }
}
