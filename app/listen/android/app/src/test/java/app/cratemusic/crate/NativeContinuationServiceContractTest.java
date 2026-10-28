package app.cratemusic.crate;

import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import org.junit.Test;

/**
 * TEST_GAP: Media3 EOF, audio focus and callbacks need a service/device runtime.
 * Policy/client tests exercise deadlines, generations and indexed retries; these guards
 * enforce their service wiring until the Xiaomi background/EOF smoke is run.
 */
public class NativeContinuationServiceContractTest {
    private String source() throws Exception {
        return new String(Files.readAllBytes(Paths.get(
            "src/main/java/app/cratemusic/crate/CrateNativePlaybackService.java"
        )), StandardCharsets.UTF_8);
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
    public void retriesUseATimerAndAreCancelledOnPause() throws Exception {
        String source = source();
        assertTrue(source.contains("mainHandler.postDelayed(retry, delayMs)"));
        assertTrue(source.contains("scheduleContinuationRetry(refillPolicy, refillRetry)"));
        int start = source.lastIndexOf("public void pause()");
        String pause = source.substring(start, source.indexOf("public void stopPlayback()", start));
        assertTrue(pause.contains("cancelContinuationRequests()"));
    }
}
