package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class NativeNetworkRecoveryPolicyTest {
    private final NativeNetworkRecoveryPolicy policy =
        new NativeNetworkRecoveryPolicy(60_000L, 5_000L);

    @Test
    public void isIdleUntilANetworkFailureArmsIt() {
        assertFalse(policy.isArmed());
        assertFalse(policy.shouldAttempt(0L));
    }

    @Test
    public void attemptsAtMostOncePerInterval() {
        policy.arm(1_000L);

        assertTrue(policy.shouldAttempt(1_000L));
        policy.markAttempt(1_000L);
        assertFalse(policy.shouldAttempt(3_000L));
        assertEquals(3_000L, policy.delayUntilNextAttemptMs(3_000L));
        assertTrue(policy.shouldAttempt(6_000L));
    }

    @Test
    public void theWindowRunsFromTheFirstFailure() {
        policy.arm(0L);
        policy.markAttempt(0L);
        // A failed attempt re-arms; the window does not restart.
        policy.arm(50_000L);

        assertTrue(policy.shouldAttempt(60_000L));
        assertTrue(policy.isExpired(60_001L));
        assertFalse(policy.shouldAttempt(60_001L));
    }

    @Test
    public void disarmingForgetsEverything() {
        policy.arm(0L);
        policy.markAttempt(0L);

        policy.disarm();

        assertFalse(policy.isArmed());
        policy.arm(100_000L);
        assertTrue(policy.shouldAttempt(100_000L));
        assertFalse(policy.isExpired(150_000L));
    }
}
