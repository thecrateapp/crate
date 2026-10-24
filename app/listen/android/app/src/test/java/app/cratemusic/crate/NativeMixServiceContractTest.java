package app.cratemusic.crate;

import static org.junit.Assert.assertTrue;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import org.junit.Test;

/**
 * TEST_GAP: Physical-deck callbacks require an Android service runtime. This JVM guard
 * locks their cancellation/revision order; device instrumentation must exercise the callbacks.
 */
public class NativeMixServiceContractTest {
    @Test
    public void queueReplacementCancelsTheOldExecutionBeforePublishingTheNewRevision() throws Exception {
        String source = new String(Files.readAllBytes(Paths.get(
            "src/main/java/app/cratemusic/crate/CrateNativePlaybackService.java"
        )), StandardCharsets.UTF_8);
        int start = source.indexOf("public void setQueue(");
        int end = source.indexOf("public void setContinuationConfig", start);
        String replacement = source.substring(start, end);
        int cancel = replacement.indexOf("cancelNativeTransition(");
        assertTrue("old execution must be cancelled", cancel >= 0);
        assertTrue(cancel < replacement.indexOf("queueState.replace("));
        assertTrue(cancel < replacement.indexOf("deckA.replaceQueue("));
        assertTrue(cancel < replacement.indexOf("deckB.replaceQueue("));
    }
}
