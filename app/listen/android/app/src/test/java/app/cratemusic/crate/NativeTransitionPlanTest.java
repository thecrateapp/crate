package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

import org.json.JSONArray;
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
    public void parsesEverySharedPlannerFixtureWithoutChangingIt() throws Exception {
        JSONObject fixture = new JSONObject(
            new String(
                Files.readAllBytes(
                    Paths.get("../../../tests/fixtures/smart_mix/transition_plans_v2.json")
                ),
                StandardCharsets.UTF_8
            )
        );
        assertEquals(
            NativeTransitionPlan.SUPPORTED_PLANNER_VERSION,
            fixture.getInt("plannerVersion")
        );
        JSONArray cases = fixture.getJSONArray("cases");
        for (int index = 0; index < cases.length(); index++) {
            JSONObject expected = cases.getJSONObject(index).getJSONObject("expected");
            JSONObject payload = new JSONObject(expected.toString());
            payload.put("outgoingTrackId", "outgoing");
            payload.put("incomingTrackId", "incoming");

            NativeTransitionPlan plan = NativeTransitionPlan.fromJson(
                payload,
                "outgoing",
                "incoming",
                3000
            );

            assertEquals(expected.getLong("durationMs"), plan.durationMs);
            assertEquals(expected.getLong("outgoingCueMs"), plan.outgoingCueMs);
            assertEquals(expected.getLong("incomingCueMs"), plan.incomingCueMs);
            assertEquals(
                expected.getString("mode").toUpperCase(java.util.Locale.ROOT),
                plan.mode.name()
            );
            assertEquals(
                (float) expected.getDouble("incomingTempoRatio"),
                plan.incomingTempoRatio,
                0.000001f
            );
        }
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
        staleVersion.put("plannerVersion", 1);
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
        plan.put("plannerVersion", 2);
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
