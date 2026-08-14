package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class NativeMixTimingTest {
    @Test
    public void startsBeforeTheOutgoingTimelineCanAutoAdvance() {
        assertFalse(
            NativeMixTiming.shouldStart(
                true,
                170_000L,
                180_000L,
                4_000L
            )
        );
        assertTrue(
            NativeMixTiming.shouldStart(
                true,
                175_970L,
                180_000L,
                4_000L
            )
        );
    }

    @Test
    public void refusesUnknownOrDisabledTimelines() {
        assertFalse(
            NativeMixTiming.shouldStart(
                true,
                0L,
                0L,
                4_000L
            )
        );
        assertFalse(
            NativeMixTiming.shouldStart(
                false,
                175_970L,
                180_000L,
                4_000L
            )
        );
        assertFalse(
            NativeMixTiming.shouldStart(
                true,
                175_970L,
                180_000L,
                0L
            )
        );
    }

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
