package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ResumeAuthorizationIntentTest {
    @Test
    public void carriesDeferredSeekAcrossAuthorizationRecovery() {
        ResumeAuthorizationIntent intent = new ResumeAuthorizationIntent(1, 5_000L, true, 4);

        ResumeAuthorizationIntent updated = intent.seekTo(42_000L);

        assertEquals(1, updated.index);
        assertEquals(42_000L, updated.positionMs);
        assertTrue(updated.playWhenReady);
    }

    @Test
    public void carriesDeferredNavigationAcrossAuthorizationRecovery() {
        ResumeAuthorizationIntent intent = new ResumeAuthorizationIntent(1, 5_000L, false, 3);

        ResumeAuthorizationIntent next = intent.next();
        ResumeAuthorizationIntent previous = next.previous();

        assertEquals(2, next.index);
        assertEquals(0L, next.positionMs);
        assertEquals(1, previous.index);
        assertEquals(0L, previous.positionMs);
        assertFalse(previous.playWhenReady);
    }

    @Test
    public void clampsDeferredNavigationToTheRestoredQueue() {
        ResumeAuthorizationIntent first = new ResumeAuthorizationIntent(0, 0L, false, 2);
        ResumeAuthorizationIntent last = new ResumeAuthorizationIntent(1, 0L, false, 2);

        assertEquals(0, first.previous().index);
        assertEquals(1, last.next().index);
        assertEquals(1, first.jumpTo(99, true).index);
        assertTrue(first.jumpTo(99, true).playWhenReady);
    }
}
