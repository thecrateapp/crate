package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class NativeContinuationPolicyTest {
    private final NativeContinuationPolicy policy = new NativeContinuationPolicy();

    private Object invokePolicy(String name, Class<?>[] parameters, Object... values) {
        try {
            return NativeContinuationPolicy.class.getDeclaredMethod(name, parameters)
                .invoke(policy, values);
        } catch (NoSuchMethodException error) {
            throw new AssertionError("Missing continuation policy contract: " + name, error);
        } catch (ReflectiveOperationException error) {
            throw new AssertionError("Could not invoke continuation policy contract: " + name, error);
        }
    }

    private boolean isTerminal() {
        return (Boolean) invokePolicy("isTerminal", new Class<?>[0]);
    }

    private void invalidateInFlight() {
        invokePolicy("invalidateInFlight", new Class<?>[0]);
    }

    private void onPlaybackEnded(long nowMs) {
        invokePolicy("onPlaybackEnded", new Class<?>[] {long.class}, nowMs);
    }

    private boolean endedDeadlineExpired(long nowMs) {
        return (Boolean) invokePolicy("endedDeadlineExpired", new Class<?>[] {long.class}, nowMs);
    }

    private long remainingEndedWaitMs(long nowMs) {
        return (Long) invokePolicy("remainingEndedWaitMs", new Class<?>[] {long.class}, nowMs);
    }

    private void clearEndedDeadline() {
        invokePolicy("clearEndedDeadline", new Class<?>[0]);
    }

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

    @Test
    public void refillsInTheBackgroundWhenThreeOrFewerTracksRemain() {
        assertFalse(policy.nextRefill(true, true, 47, 50, 0L));
        assertFalse(policy.nextRefill(false, true, 45, 50, 0L));
        assertTrue(policy.nextRefill(false, true, 46, 50, 0L));
        assertFalse(policy.nextRefill(false, true, 46, 50, 0L));
    }

    @Test
    public void stopsRefillingOnceTheSourceIsExhausted() {
        assertTrue(policy.nextRefill(false, true, 48, 50, 0L));
        policy.onExhausted();

        assertFalse(policy.nextRefill(false, true, 49, 50, 600_000L));
        policy.reset();
        assertTrue(policy.nextRefill(false, true, 49, 50, 600_000L));
    }

    @Test
    public void exposesTheRetryDeadlineWithoutAnotherTrackEvent() {
        assertTrue(policy.nextRefill(false, true, 49, 50, 1_000L));
        policy.onFailure(1_000L);

        assertEquals(10_000L, policy.retryDelayMs(1_000L));
        assertEquals(1L, policy.retryDelayMs(10_999L));
        assertEquals(0L, policy.retryDelayMs(11_000L));
        assertTrue(policy.nextRefill(false, true, 49, 50, 11_000L));
        policy.onSuccess();
        assertEquals(-1L, policy.retryDelayMs(11_000L));
    }

    @Test
    public void resettingTheConfigurationRejectsResultsFromThePreviousGeneration() {
        assertTrue(policy.nextRefill(false, true, 49, 50, 0L));
        long generation = policy.generation();
        assertTrue(policy.acceptsResult(generation));

        policy.reset();
        assertFalse(policy.acceptsResult(generation));
        assertTrue(policy.nextRefill(false, true, 49, 50, 0L));
        assertTrue(policy.acceptsResult(policy.generation()));
    }

    @Test
    public void exhaustedRefillStaysTerminalAcrossForegroundUntilAConfigurationReset() {
        assertTrue(policy.nextRefill(false, true, 49, 50, 0L));
        policy.onExhausted();

        assertTrue(isTerminal());
        invalidateInFlight();
        assertTrue(isTerminal());
        assertFalse(policy.nextRefill(false, true, 49, 50, 600_000L));

        policy.reset();
        assertFalse(isTerminal());
        assertTrue(policy.nextRefill(false, true, 49, 50, 600_000L));
    }

    @Test
    public void unauthorizedRefillStaysTerminalAcrossForegroundUntilNewAuthorization() {
        assertTrue(policy.nextRefill(false, true, 49, 50, 0L));
        policy.onUnauthorized();

        assertTrue(isTerminal());
        invalidateInFlight();
        assertTrue(isTerminal());
        assertFalse(policy.nextRefill(false, true, 49, 50, 600_000L));

        policy.reset();
        assertFalse(isTerminal());
        assertTrue(policy.nextRefill(false, true, 49, 50, 600_000L));
    }

    @Test
    public void foregroundInvalidationRejectsOldResultsButAllowsTheNewGeneration() {
        assertTrue(policy.nextRefill(false, true, 49, 50, 1_000L));
        long previousGeneration = policy.generation();
        assertTrue(policy.acceptsResult(previousGeneration));

        invalidateInFlight();

        assertEquals(previousGeneration + 1L, policy.generation());
        assertFalse(policy.acceptsResult(previousGeneration));
        assertTrue(policy.nextRefill(false, true, 49, 50, 1_000L));
        assertTrue(policy.acceptsResult(policy.generation()));
    }

    @Test
    public void foregroundPreservesBothRetryDeadlineAndConsecutiveFailureCount() {
        assertTrue(policy.nextRefill(false, true, 49, 50, 1_000L));
        policy.onFailure(1_000L);

        invalidateInFlight();
        invalidateInFlight();

        assertEquals(10_000L, policy.retryDelayMs(1_000L));
        assertFalse(policy.nextRefill(false, true, 49, 50, 10_999L));
        assertTrue(policy.nextRefill(false, true, 49, 50, 11_000L));
        policy.onFailure(11_000L);
        invalidateInFlight();

        assertEquals(30_000L, policy.retryDelayMs(11_000L));
        assertFalse(policy.nextRefill(false, true, 49, 50, 40_999L));
        assertTrue(policy.nextRefill(false, true, 49, 50, 41_000L));
    }

    @Test
    public void endedDeadlineIsInactiveUntilPlaybackActuallyEnds() {
        assertFalse(endedDeadlineExpired(0L));
        assertFalse(endedDeadlineExpired(600_000L));
        assertEquals(-1L, remainingEndedWaitMs(0L));
        assertEquals(-1L, remainingEndedWaitMs(600_000L));
    }

    @Test
    public void endedPlaybackExpiresAtSixtySecondsEvenWhenMonotonicClockStartsAtZero() {
        onPlaybackEnded(0L);

        assertEquals(60_000L, remainingEndedWaitMs(0L));
        assertEquals(1L, remainingEndedWaitMs(59_999L));
        assertFalse(endedDeadlineExpired(59_999L));
        assertTrue(endedDeadlineExpired(60_000L));
        assertTrue(endedDeadlineExpired(600_000L));
        assertEquals(0L, remainingEndedWaitMs(60_000L));
        assertEquals(0L, remainingEndedWaitMs(600_000L));
    }

    @Test
    public void repeatedEndedNotificationsAndForegroundDoNotRenewTheFocusDeadline() {
        onPlaybackEnded(1_000L);
        onPlaybackEnded(20_000L);
        invalidateInFlight();
        onPlaybackEnded(50_000L);
        invalidateInFlight();

        assertEquals(11_000L, remainingEndedWaitMs(50_000L));
        assertEquals(1L, remainingEndedWaitMs(60_999L));
        assertFalse(endedDeadlineExpired(60_999L));
        assertTrue(endedDeadlineExpired(61_000L));
        assertEquals(0L, remainingEndedWaitMs(61_000L));
    }

    @Test
    public void invalidatingAnExpiredEndedWaitRejectsTheOldRefillAndKeepsItsDeadlineExpired() {
        assertTrue(policy.nextRefill(false, true, 49, 50, 1_000L));
        long requestGeneration = policy.generation();
        onPlaybackEnded(1_000L);
        assertTrue(policy.acceptsResult(requestGeneration));
        assertTrue(endedDeadlineExpired(61_000L));

        invalidateInFlight();

        assertFalse(policy.acceptsResult(requestGeneration));
        assertEquals(requestGeneration + 1L, policy.generation());
        assertTrue(endedDeadlineExpired(61_000L));
        assertEquals(0L, remainingEndedWaitMs(61_000L));
    }

    @Test
    public void clearingTheDeadlineAllowsANewEndedWaitAfterPlaybackResumes() {
        onPlaybackEnded(1_000L);
        clearEndedDeadline();

        assertFalse(endedDeadlineExpired(100_000L));
        assertEquals(-1L, remainingEndedWaitMs(100_000L));
        onPlaybackEnded(100_000L);
        assertFalse(endedDeadlineExpired(159_999L));
        assertTrue(endedDeadlineExpired(160_000L));
    }

    @Test
    public void resettingQueueOrAuthorizationClearsTerminalBackoffAndEndedDeadline() {
        assertTrue(policy.nextRefill(false, true, 49, 50, 1_000L));
        policy.onFailure(1_000L);
        onPlaybackEnded(1_000L);
        policy.onUnauthorized();

        policy.reset();

        assertFalse(isTerminal());
        assertEquals(-1L, policy.retryDelayMs(1_000L));
        assertFalse(endedDeadlineExpired(600_000L));
        assertEquals(-1L, remainingEndedWaitMs(600_000L));
        assertTrue(policy.nextRefill(false, true, 49, 50, 1_000L));
    }
}
