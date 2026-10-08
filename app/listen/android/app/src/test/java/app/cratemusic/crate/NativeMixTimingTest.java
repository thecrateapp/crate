package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class NativeMixTimingTest {
    @Test
    public void progressIsMonotonicAndClamped() {
        assertEquals(
            0.0f,
            NativeMixTiming.progress(1_000L, 1_000L, 4_000L),
            0.0001f
        );
        assertEquals(
            0.5f,
            NativeMixTiming.progress(3_000L, 1_000L, 4_000L),
            0.0001f
        );
        assertEquals(
            1.0f,
            NativeMixTiming.progress(9_000L, 1_000L, 4_000L),
            0.0001f
        );
    }
}
