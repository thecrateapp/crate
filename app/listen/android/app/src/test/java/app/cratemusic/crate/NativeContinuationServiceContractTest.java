package app.cratemusic.crate;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import org.junit.Test;

/**
 * TEST_GAP: Media3 EOF, audio focus and callbacks need a service/device runtime.
 * Policy/client tests exercise deadlines, generations and indexed retries; these guards
 * enforce their service wiring until the Xiaomi background/EOF smoke is run.
 * A bound service surviving stopSelf and receiving a late refill still needs physical QA.
 */
public class NativeContinuationServiceContractTest {
    private String source() throws Exception {
        return new String(Files.readAllBytes(Paths.get(
            "src/main/java/app/cratemusic/crate/CrateNativePlaybackService.java"
        )), StandardCharsets.UTF_8);
    }

    private String method(String source, String signature) {
        int start = source.lastIndexOf(signature);
        assertTrue("Missing service method: " + signature, start >= 0);
        int open = source.indexOf('{', start);
        int depth = 1;
        for (int end = open + 1; end < source.length(); end++) {
            if (source.charAt(end) == '{') depth++;
            if (source.charAt(end) == '}' && --depth == 0) {
                return source.substring(start, end + 1);
            }
        }
        throw new AssertionError("Unclosed service method: " + signature);
    }

    @Test
    public void exhaustedRefillCannotKeepAudioFocusAtEnded() throws Exception {
        String canContinue = method(source(), "private boolean canContinuePlayback()");
        assertTrue(
            "Playback eligibility must reject exhausted and unauthorized refill policy",
            canContinue.contains("!refillPolicy.isTerminal()")
        );
    }

    @Test
    public void foregroundOnlyInvalidatesRequestsInsteadOfResettingRetryAndTerminalState() throws Exception {
        String foreground = method(source(), "public void setAppInForeground(boolean foreground)");
        assertFalse(
            "Foreground must preserve exhausted/unauthorized state and retry backoff",
            foreground.contains("cancelContinuationRequests()")
        );
        assertTrue(foreground.contains("refillPolicy.invalidateInFlight()"));
        assertTrue(foreground.contains("continuationPolicy.invalidateInFlight()"));
        assertFalse(foreground.contains(".reset()"));
        assertFalse(foreground.contains("clearEndedDeadline()"));
    }

    @Test
    public void endedWaitUsesAMonotonicDeadlineInsteadOfRetryingWithoutALimit() throws Exception {
        String source = source();
        String stateChanged = method(source, "public void onPlaybackStateChanged(int playbackState)");
        assertTrue(
            "Entering ENDED must start the bounded wait using elapsedRealtime",
            stateChanged.contains("onPlaybackEnded(SystemClock.elapsedRealtime())")
        );
        assertTrue(
            "The service must check the ENDED deadline even without another player callback",
            source.contains("endedDeadlineExpired(SystemClock.elapsedRealtime())")
        );
        String ended = method(stateChanged, "if (playbackState == Player.STATE_ENDED)");
        assertTrue(ended.contains("settleEndedPlayback()"));
        assertTrue(ended.contains("mainHandler.postDelayed("));
        assertTrue(ended.contains("endedPlaybackTimeout"));
        assertTrue(ended.contains("remainingEndedWaitMs(SystemClock.elapsedRealtime())"));
        assertFalse(
            "Repeated ENDED callbacks must not restart the grace period",
            ended.contains("clearEndedDeadline()")
        );
    }

    @Test
    public void exhaustedRefillSettlesAnAlreadyEndedPlayerImmediately() throws Exception {
        String applyRefill = method(source(), "private void applyRefill(");
        String exhausted = method(applyRefill, "if (result.exhausted)");
        int terminal = exhausted.indexOf("refillPolicy.onExhausted()");
        int settle = exhausted.indexOf("settleEndedPlayback()");

        assertTrue("An exhausted response must make refill terminal", terminal >= 0);
        assertTrue(
            "Exhaustion after the ENDED callback must release focus immediately",
            settle > terminal
        );
    }

    @Test
    public void unauthorizedRefillSettlesAnAlreadyEndedPlayerImmediately() throws Exception {
        String unauthorized = method(source(), "private void invalidateContinuationAuthorization()");
        int terminal = unauthorized.indexOf("refillPolicy.onUnauthorized()");
        int settle = unauthorized.indexOf("settleEndedPlayback()");

        assertTrue("An unauthorized response must make refill terminal", terminal >= 0);
        assertTrue(
            "Lost authorization after the ENDED callback must release focus immediately",
            settle > terminal
        );
    }

    @Test
    public void endedTimeoutReleasesFocusAndStopsOnlyAnEndedService() throws Exception {
        String source = source();
        assertTrue(
            "The handler timeout must invoke the same terminal playback settlement",
            source.contains("Runnable endedPlaybackTimeout = this::settleEndedPlayback")
        );
        String settle = method(source, "private void settleEndedPlayback()");
        assertTrue(settle.contains("player.getPlaybackState()"));
        assertTrue(settle.contains("Player.STATE_ENDED"));
        assertTrue(settle.contains("canContinuePlayback()"));
        assertTrue(settle.contains("endedDeadlineExpired(SystemClock.elapsedRealtime())"));
        int abandon = settle.indexOf("abandonPlaybackFocus()");
        int stop = settle.indexOf("stopSelf()");
        assertTrue("Settling ENDED must abandon audio focus", abandon >= 0);
        assertTrue("Settling ENDED must stop the service after releasing focus", stop > abandon);
    }

    @Test
    public void expiredEndedDeadlineCannotAuthorizePlaybackWhileTheServiceRemainsBound() throws Exception {
        String canContinue = method(source(), "private boolean canContinuePlayback()");
        assertTrue(
            "A bound service must reject continuation after the ENDED deadline",
            canContinue.contains("!refillPolicy.endedDeadlineExpired(SystemClock.elapsedRealtime())")
        );
    }

    @Test
    public void settlingEndedPlaybackInvalidatesPendingRefillsWithoutResettingTheExpiredDeadline() throws Exception {
        String settle = method(source(), "private void settleEndedPlayback()");
        int abandon = settle.indexOf("abandonPlaybackFocus()");
        for (String invalidation : new String[] {
            "mainHandler.removeCallbacks(refillRetry)",
            "mainHandler.removeCallbacks(planRetry)",
            "refillPolicy.invalidateInFlight()",
            "continuationPolicy.invalidateInFlight()"
        }) {
            int invalidated = settle.indexOf(invalidation);
            assertTrue(
                "Before releasing focus, settlement must invalidate late work: " + invalidation,
                invalidated >= 0 && invalidated < abandon
            );
        }
        assertFalse("Settlement must preserve terminal and expired deadline", settle.contains(".reset()"));
        assertFalse(settle.contains("cancelContinuationRequests()"));
        assertFalse(settle.contains("clearEndedDeadline()"));
    }

    @Test
    public void installingNewContinuationConfigurationWhileAlreadyEndedArmsAFreshDeadline() throws Exception {
        String configure = method(source(), "public void setContinuationConfig(");
        assertTrue(configure.contains("player.getPlaybackState()"));
        assertTrue(configure.contains("Player.STATE_ENDED"));
        assertTrue(configure.contains("canContinuePlayback()"));
        assertTrue(
            "A new configuration must bound ENDED even without another Media3 callback",
            configure.contains("refillPolicy.onPlaybackEnded(SystemClock.elapsedRealtime())")
        );
        assertTrue(configure.contains("mainHandler.postDelayed("));
        assertTrue(configure.contains("endedPlaybackTimeout"));
        assertTrue(configure.contains("remainingEndedWaitMs(SystemClock.elapsedRealtime())"));
    }

    @Test
    public void clearingContinuationConfigurationSettlesEndedPlaybackWithoutAnotherPlayerCallback() throws Exception {
        String configure = method(source(), "public void setContinuationConfig(");
        int installed = configure.indexOf("continuationConfig = config");
        int settled = configure.indexOf("settleEndedPlayback()");
        int armed = configure.indexOf("refillPolicy.onPlaybackEnded(");
        int refill = configure.indexOf("maybeRefillQueue()");
        assertTrue(installed >= 0);
        assertTrue(
            "Installing null or unusable config must settle ENDED after replacing the config",
            settled > installed && settled < armed && settled < refill
        );
    }

    private void assertRepeatSetterKeepsTheEndedWait(String setter) {
        assertFalse(
            "Repeat changes must retain the existing ENDED grace instead of resetting it",
            setter.contains("cancelContinuationRequests()")
        );
        assertFalse(setter.contains(".reset()"));
        assertFalse(setter.contains("clearEndedDeadline()"));
        assertFalse(setter.contains("mainHandler.removeCallbacks(endedPlaybackTimeout)"));
        assertTrue(setter.contains("mainHandler.removeCallbacks(refillRetry)"));
        assertTrue(setter.contains("mainHandler.removeCallbacks(planRetry)"));
        assertTrue(setter.contains("refillPolicy.invalidateInFlight()"));
        assertTrue(setter.contains("continuationPolicy.invalidateInFlight()"));
        int modeChanged = setter.indexOf("deckBPlayer.setRepeatMode(repeatMode)");
        int settled = setter.indexOf("settleEndedPlayback()");
        assertTrue(
            "Repeat eligibility must be checked after installing the new mode, without waiting for Media3",
            modeChanged >= 0 && settled > modeChanged
        );
    }

    @Test
    public void changingRepeatKeepsTheExistingEndedDeadlineAndSettlesIneligiblePlayback() throws Exception {
        assertRepeatSetterKeepsTheEndedWait(method(source(), "public void setRepeat(String repeat)"));
    }

    @Test
    public void mediaSessionRepeatChangeKeepsTheExistingEndedDeadlineAndSettlesIneligiblePlayback() throws Exception {
        assertRepeatSetterKeepsTheEndedWait(method(source(), "public void beforeRepeatModeChange(int repeatMode)"));
    }

    @Test
    public void activePlaybackCancelsTheEndedTimerAndClearsItsDeadline() throws Exception {
        String stateChanged = method(source(), "public void onPlaybackStateChanged(int playbackState)");
        assertTrue(
            "Returning to active playback must cancel the pending ENDED timeout",
            stateChanged.contains("mainHandler.removeCallbacks(endedPlaybackTimeout)")
        );
        assertTrue(stateChanged.contains("refillPolicy.clearEndedDeadline()"));
    }

    @Test
    public void pauseReplacementAndDestructionCancelTheEndedTimer() throws Exception {
        String source = source();
        String cancel = method(source, "private void cancelContinuationRequests()");
        assertTrue(
            "Full cancellation must remove the ENDED callback before a later queue can play",
            cancel.contains("mainHandler.removeCallbacks(endedPlaybackTimeout)")
        );
        assertTrue(cancel.contains("refillPolicy.reset()"));
        String[] lifecycleMethods = {
            "public void pause()",
            "public void stopPlayback()",
            "public void setQueue(",
            "public void setContinuationConfig(",
            "public void onDestroy()"
        };
        for (String signature : lifecycleMethods) {
            assertTrue(
                signature + " must cancel continuation and its ENDED timeout",
                method(source, signature).contains("cancelContinuationRequests()")
            );
        }
    }

    @Test
    public void rejectsAnOldRefillBeforeApplyingItsAuthorizationFailure() throws Exception {
        String source = source();
        int start = source.indexOf("private void applyRefill(");
        String apply = source.substring(start, source.indexOf("private void recordAppended(", start));
        assertTrue(apply.indexOf("!revision.equals(queueState.revision())") >= 0);
        assertTrue(apply.indexOf("!refillPolicy.acceptsResult(generation)") >= 0);
        assertTrue(apply.indexOf("!revision.equals(queueState.revision())")
            < apply.indexOf("Outcome.UNAUTHORIZED"));
        assertTrue(apply.indexOf("!refillPolicy.acceptsResult(generation)")
            < apply.indexOf("Outcome.UNAUTHORIZED"));
    }

    @Test
    public void postedRefillSettlesAnExpiredEndedDeadlineBeforeAcceptingOrAppendingItsResult() throws Exception {
        String apply = method(source(), "private void applyRefill(");
        int settled = apply.indexOf("settleEndedPlayback()");
        int accepted = apply.indexOf("refillPolicy.acceptsResult(generation)");
        int append = apply.indexOf("appendTracks(revision, result.tracks)");
        assertTrue(
            "A response posted before 60s but handled after expiry must invalidate its generation first",
            settled >= 0 && settled < accepted
        );
        assertTrue(settled < append);
    }

    @Test
    public void retriesUseATimerAndAreCancelledOnPause() throws Exception {
        String source = source();
        assertTrue(source.contains("mainHandler.postDelayed(retry, delayMs)"));
        assertTrue(source.contains("scheduleContinuationRetry(refillPolicy, refillRetry)"));
        int start = source.lastIndexOf("public void pause()");
        String pause = source.substring(start, source.indexOf("public void stopPlayback()", start));
        assertTrue(pause.contains("cancelContinuationRequests()"));
    }
}
