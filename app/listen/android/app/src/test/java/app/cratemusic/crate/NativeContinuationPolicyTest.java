package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class NativeContinuationPolicyTest {
    private final NativeContinuationPolicy policy = new NativeContinuationPolicy();

    private NativeContinuationPolicy.Window background(
        int currentIndex,
        int queueSize,
        int plannedAhead,
        long nowMs
    ) {
        return policy.nextRequest(false, true, true, currentIndex, queueSize, plannedAhead, nowMs);
    }

    @Test
    public void neverRequestsWhileTheAppIsInTheForeground() {
        assertNull(policy.nextRequest(true, true, true, 10, 50, 0, 0L));
    }

    @Test
    public void needsAUsableTokenAndSmartMixEnabled() {
        assertNull(policy.nextRequest(false, false, true, 10, 50, 0, 0L));
        assertNull(policy.nextRequest(false, true, false, 10, 50, 0, 0L));
    }

    @Test
    public void requestsUpToThirtyTwoEdgesWhenServerPlansRunOut() {
        NativeContinuationPolicy.Window window = background(10, 50, 2, 0L);

        assertNotNull(window);
        assertEquals(10, window.fromIndex);
        assertEquals(NativeContinuationPolicy.MAX_EDGES, window.edgeCount);
    }

    @Test
    public void staysQuietWhileEnoughServerPlansAreAhead() {
        assertNull(background(10, 50, NativeContinuationPolicy.MIN_PLANNED_EDGES, 0L));
    }

    @Test
    public void coversTheShortTailOfTheQueueWithoutRepeating() {
        NativeContinuationPolicy.Window window = background(47, 50, 1, 0L);

        assertNotNull(window);
        assertEquals(2, window.edgeCount);
        policy.onSuccess();
        assertNull(background(48, 50, 1, 0L));
        assertNull(background(49, 50, 0, 0L));
    }

    @Test
    public void keepsASingleRequestInFlight() {
        assertNotNull(background(10, 50, 0, 0L));

        assertNull(background(11, 50, 0, 0L));

        policy.onSuccess();
        assertNotNull(background(11, 50, 0, 0L));
    }

    @Test
    public void backsOffAfterFailures() {
        background(10, 50, 0, 1_000L);
        policy.onFailure(1_000L);

        assertNull(background(10, 50, 0, 10_999L));
        assertNotNull(background(10, 50, 0, 11_000L));

        policy.onFailure(11_000L);
        assertNull(background(10, 50, 0, 40_999L));
        assertNotNull(background(10, 50, 0, 41_000L));
    }

    @Test
    public void anUnauthorizedAnswerStopsUntilANewTokenArrives() {
        background(10, 50, 0, 0L);
        policy.onUnauthorized();

        assertNull(background(11, 50, 0, 600_000L));

        policy.reset();
        assertNotNull(background(11, 50, 0, 600_000L));
    }
}
