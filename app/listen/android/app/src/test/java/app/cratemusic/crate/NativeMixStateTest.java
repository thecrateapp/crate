package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import com.getcapacitor.JSObject;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import org.json.JSONObject;
import org.junit.Test;

public class NativeMixStateTest {
    @Test
    public void onlyAnEffectiveNoOverlapPolicyConfirmsGapless() {
        assertNull(gapless(4000, true, false, false, false));
        assertGapless(gapless(0, true, false, false, false));
        assertGapless(gapless(4000, false, false, false, false));
        assertGapless(gapless(4000, true, false, true, false));
        assertGapless(gapless(4000, true, false, false, true));
        assertNull(gapless(0, true, true, false, false));
        assertNull(NativeMixState.confirmedGapless("r1", 0, null, "two", 0,
            false, false, false, false));
        assertNull(NativeMixState.confirmedGapless("r1", 0, "one", null, 0,
            false, false, false, false));
    }

    @Test
    public void snapshotSerializesTheConfirmedTechniqueAndPair() throws Exception {
        NativeMixState state = NativeMixState.mixing("r1", 7,
            NativeTransitionPlan.safeFallback("one", "two", 4000, "test"),
            false, false);
        JSONObject json = state.toJson();
        assertEquals("r1", json.getString("revision"));
        assertEquals(7L, json.getLong("executionId"));
        assertEquals("crossfade", json.getString("mode"));
        assertEquals("mixing", json.getString("phase"));
        assertFalse(json.getBoolean("bassHandoff"));
        assertEquals("one", json.getString("outgoingTrackId"));
        assertEquals("two", json.getString("incomingTrackId"));
        assertEquals(4000L, json.getLong("durationMs"));
    }

    @Test
    public void discreteEventsPreserveMetadataAndClearFinishedMixes() throws Exception {
        List<JSObject> events = new ArrayList<>();
        AtomicLong sequence = new AtomicLong();
        NativeMixStateReporter reporter = new NativeMixStateReporter(events::add);
        NativeMixState active = NativeMixState.mixing("r1", 7,
            NativeTransitionPlan.safeFallback("one", "two", 4000, "test"),
            false, false);
        reporter.publish("r1", active, () -> envelope("r1", sequence));
        for (int tick = 0; tick < 50; tick++) {
            reporter.publish("r1", NativeMixState.mixing("r1", 7,
                NativeTransitionPlan.safeFallback("one", "two", 4000, "test"),
                false, false), () -> envelope("r1", sequence));
        }
        assertEquals(1, events.size());
        assertEquals(1L, sequence.get());
        assertEquals("crossfade", events.get(0).getJSONObject("mixState").getString("mode"));
        assertEquals(1L, events.get(0).getLong("nativeSequence"));
        assertEquals(123L, events.get(0).getLong("nativeTimeMs"));
        reporter.publish("r1", null, () -> envelope("r1", sequence));
        assertEquals(2, events.size());
        assertTrue(events.get(1).has("mixState"));
        assertTrue(events.get(1).isNull("mixState"));
        reporter.publish("r1", null, () -> envelope("r1", sequence));
        assertEquals(2, events.size());
        reporter.publish("r2", null, () -> envelope("r2", sequence));
        assertEquals(3, events.size());
        assertEquals("r2", events.get(2).getString("revision"));
        assertTrue(events.get(2).isNull("mixState"));
    }

    private NativeMixState gapless(int crossfadeMs, boolean mixable,
        boolean repeatOne, boolean planGapless, boolean fellBack) {
        return NativeMixState.confirmedGapless("r1", 0, "one", "two", crossfadeMs,
            mixable, repeatOne, planGapless, fellBack);
    }

    private void assertGapless(NativeMixState state) {
        assertNotNull(state);
        assertEquals("gapless", state.mode);
        assertEquals("idle", state.phase);
        assertFalse(state.bassHandoff);
    }

    private static JSObject envelope(String revision, AtomicLong sequence) {
        return new JSObject().put("revision", revision)
            .put("nativeSequence", sequence.incrementAndGet()).put("nativeTimeMs", 123L);
    }
}
