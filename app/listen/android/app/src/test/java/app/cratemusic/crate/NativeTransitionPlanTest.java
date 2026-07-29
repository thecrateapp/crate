package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.json.JSONObject;
import org.junit.Test;

public class NativeTransitionPlanTest {

    @Test
    public void parsesVersionedAdjacentPlan() throws Exception {
        NativeTransitionPlan plan = NativeTransitionPlan.fromJson(
            planJson("outgoing", "incoming"),
            "outgoing",
            "incoming",
            3000
        );

        assertEquals(NativeTransitionPlan.Mode.ADAPTIVE, plan.mode);
        assertEquals(4200L, plan.durationMs);
        assertEquals(0.5f, plan.handoffProgress, 0.0001f);
        assertEquals("equal-power", plan.curve);
    }

    @Test
    public void missingPlanProducesExplicitSafeFallback() {
        NativeTransitionPlan plan = NativeTransitionPlan.fromJson(
            null,
            "outgoing",
            "incoming",
            3500
        );

        assertEquals(NativeTransitionPlan.Mode.ADAPTIVE, plan.mode);
        assertEquals(3500L, plan.durationMs);
        assertEquals("missing_plan", plan.fallbackReason);
        assertEquals("outgoing", plan.outgoingTrackId);
        assertEquals("incoming", plan.incomingTrackId);
    }

    @Test
    public void rejectsInvalidOrNonAdjacentPlans() throws Exception {
        assertThrows(
            IllegalArgumentException.class,
            () ->
                NativeTransitionPlan.fromJson(
                    planJson("other", "incoming"),
                    "outgoing",
                    "incoming",
                    3000
                )
        );

        JSONObject negativeDuration = planJson("outgoing", "incoming");
        negativeDuration.put("durationMs", -1);
        assertThrows(
            IllegalArgumentException.class,
            () ->
                NativeTransitionPlan.fromJson(
                    negativeDuration,
                    "outgoing",
                    "incoming",
                    3000
                )
        );

        JSONObject unsupportedRatio = planJson("outgoing", "incoming");
        unsupportedRatio.put("incomingTempoRatio", 1.2);
        assertThrows(
            IllegalArgumentException.class,
            () ->
                NativeTransitionPlan.fromJson(
                    unsupportedRatio,
                    "outgoing",
                    "incoming",
                    3000
                )
        );

        JSONObject staleVersion = planJson("outgoing", "incoming");
        staleVersion.put("plannerVersion", 2);
        assertThrows(
            IllegalArgumentException.class,
            () ->
                NativeTransitionPlan.fromJson(
                    staleVersion,
                    "outgoing",
                    "incoming",
                    3000
                )
        );
    }

    private static JSONObject planJson(
        String outgoingTrackId,
        String incomingTrackId
    ) throws Exception {
        JSONObject plan = new JSONObject();
        plan.put("plannerVersion", 1);
        plan.put("outgoingTrackId", outgoingTrackId);
        plan.put("incomingTrackId", incomingTrackId);
        plan.put("mode", "adaptive");
        plan.put("durationMs", 4200);
        plan.put("outgoingCueMs", 170000);
        plan.put("incomingCueMs", 0);
        plan.put("incomingTempoRatio", 1.0);
        plan.put("beatPhaseOffsetMs", 0);
        plan.put("handoffProgress", 0.5);
        plan.put("outgoingGainDb", 0.0);
        plan.put("incomingGainDb", 0.0);
        plan.put("curve", "equal-power");
        plan.put("bassHandoff", "none");
        plan.put("confidence", 0.8);
        return plan;
    }
}
