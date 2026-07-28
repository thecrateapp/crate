package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class NativePositionTickerPolicyTest {
    @Test
    public void stopsWhenPlaybackIsIdleOrPaused() {
        assertEquals(0L, NativePositionTickerPolicy.nextDelayMs(false, true, true));
        assertEquals(0L, NativePositionTickerPolicy.nextDelayMs(true, false, true));
    }

    @Test
    public void usesForegroundAndBackgroundCadences() {
        assertEquals(500L, NativePositionTickerPolicy.nextDelayMs(true, true, true));
        assertEquals(1000L, NativePositionTickerPolicy.nextDelayMs(true, true, false));
    }
}
