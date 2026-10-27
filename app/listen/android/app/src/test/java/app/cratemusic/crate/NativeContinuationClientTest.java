package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class NativeContinuationClientTest {
    private static final NativeContinuationClient.Config CONFIG =
        new NativeContinuationClient.Config(
            "https://api.example/",
            "crv_continuation",
            2_000_000L,
            "playlist",
            12_000L,
            false
        );

    private final List<NativeTrack> tracks = Arrays.asList(
        track("runtime-1", "uid-1"),
        track("runtime-2", "uid-2"),
        track("runtime-3", ""),
        track("runtime-4", "uid-4"),
        track("runtime-5", "uid-5")
    );

    private static final class RecordingTransport implements NativeContinuationClient.Transport {
        String url;
        String token;
        String body;
        NativeContinuationClient.Response response;
        IOException failure;

        @Override
        public NativeContinuationClient.Response post(String url, String bearerToken, String body)
            throws IOException {
            this.url = url;
            this.token = bearerToken;
            this.body = body;
            if (failure != null) throw failure;
            return response;
        }
    }

    @Test
    public void requestsOnlyEdgesWithEntityUidsAndTheQueueContext() throws Exception {
        JSONObject body = NativeContinuationClient.requestBody(CONFIG, tracks, 0, 4);

        assertEquals("smart-mix-v2", body.getString("plannerVersion"));
        JSONArray edges = body.getJSONArray("edges");
        assertEquals(2, edges.length());
        assertEquals("uid-1", edges.getJSONObject(0).getString("outgoingTrackEntityUid"));
        assertEquals("uid-2", edges.getJSONObject(0).getString("incomingTrackEntityUid"));
        assertEquals("uid-4", edges.getJSONObject(1).getString("outgoingTrackEntityUid"));
        JSONObject context = edges.getJSONObject(0).getJSONObject("context");
        assertEquals("playlist", context.getString("source"));
        assertEquals(12_000L, context.getLong("preferredDurationMs"));
        assertFalse(context.getBoolean("allowBeatmatch"));
        assertFalse(context.has("allowBassHandoff"));
        assertFalse(context.has("allowLongBeatmatch"));
    }

    @Test
    public void continuationsAskForLongPhraseMixesOnlyWhenTheServerOffersThem() throws Exception {
        NativeContinuationClient.Config offered = NativeContinuationClient.Config.fromJson(
            new JSONObject(
                "{\"token\":\"crv_x\",\"allowBeatmatch\":true,\"allowLongBeatmatch\":true}"
            )
        );
        NativeContinuationClient.Config notOffered = NativeContinuationClient.Config.fromJson(
            new JSONObject("{\"token\":\"crv_x\",\"allowBeatmatch\":true}")
        );
        NativeContinuationClient.Config withoutBeatmatch = NativeContinuationClient.Config.fromJson(
            new JSONObject(
                "{\"token\":\"crv_x\",\"allowBeatmatch\":false,\"allowLongBeatmatch\":true}"
            )
        );

        assertTrue(contextFor(offered).getBoolean("allowLongBeatmatch"));
        assertFalse(contextFor(notOffered).has("allowLongBeatmatch"));
        assertFalse(contextFor(withoutBeatmatch).has("allowLongBeatmatch"));
    }

    private JSONObject contextFor(NativeContinuationClient.Config config) throws Exception {
        return NativeContinuationClient.requestBody(config, tracks, 0, 4)
            .getJSONArray("edges")
            .getJSONObject(0)
            .getJSONObject("context");
    }

    @Test
    public void mapsServerPlansBackToRuntimeTrackIds() throws Exception {
        RecordingTransport transport = new RecordingTransport();
        transport.response = new NativeContinuationClient.Response(
            200,
            new JSONObject()
                .put("plannerVersion", "smart-mix-v2")
                .put(
                    "plans",
                    new JSONArray().put(
                        new JSONObject()
                            .put("outgoingTrackEntityUid", "uid-4")
                            .put("incomingTrackEntityUid", "uid-5")
                            .put("plannerVersion", 2)
                            .put("mode", "adaptive")
                            .put("outgoingCueMs", 204_101L)
                    )
                )
                .toString()
        );

        NativeContinuationClient.Result result = new NativeContinuationClient(transport)
            .fetchPlans(CONFIG, tracks, 0, 4);

        assertEquals("https://api.example/api/playback/transition-plans", transport.url);
        assertEquals("crv_continuation", transport.token);
        assertEquals(NativeContinuationClient.Outcome.PLANNED, result.outcome);
        assertEquals(1, result.plans.size());
        JSONObject plan = result.plans.get(0);
        assertEquals("runtime-4", plan.getString("outgoingTrackId"));
        assertEquals("runtime-5", plan.getString("incomingTrackId"));
        assertEquals(204_101L, plan.getLong("outgoingCueMs"));
    }

    @Test
    public void reportsUnauthorizedAndFailedRequests() {
        RecordingTransport transport = new RecordingTransport();
        NativeContinuationClient client = new NativeContinuationClient(transport);

        transport.response = new NativeContinuationClient.Response(401, "");
        assertEquals(
            NativeContinuationClient.Outcome.UNAUTHORIZED,
            client.fetchPlans(CONFIG, tracks, 0, 2).outcome
        );
        transport.response = new NativeContinuationClient.Response(503, "");
        assertEquals(
            NativeContinuationClient.Outcome.FAILED,
            client.fetchPlans(CONFIG, tracks, 0, 2).outcome
        );
        transport.failure = new IOException("connection refused");
        assertEquals(
            NativeContinuationClient.Outcome.FAILED,
            client.fetchPlans(CONFIG, tracks, 0, 2).outcome
        );
    }

    @Test
    public void ignoresAResponseFromAnotherPlannerVersion() throws Exception {
        List<JSONObject> plans = NativeContinuationClient.parsePlans(
            "{\"plannerVersion\":\"smart-mix-v1\",\"plans\":[]}",
            tracks,
            0,
            4
        );

        assertTrue(plans.isEmpty());
    }

    @Test
    public void readsAnEpochExpiryThatDoesNotFitInAnInt() throws Exception {
        JSONObject payload = new JSONObject(
            "{\"token\":\"crv_x\",\"expiresAtMs\":1792356133889,"
                + "\"apiBase\":\"http://localhost:8585/\",\"source\":\"playlist\","
                + "\"preferredDurationMs\":12000,\"allowBeatmatch\":false}"
        );

        NativeContinuationClient.Config config =
            NativeContinuationClient.Config.fromJson(payload);

        assertEquals(1_792_356_133_889L, config.expiresAtMs);
        assertEquals("http://localhost:8585", config.apiBase);
        assertEquals(12_000L, config.preferredDurationMs);
        assertTrue(config.isUsable(1_792_313_242_000L));
    }

    @Test
    public void bassHandoffIsOnlyRequestedWithBeatmatch() throws Exception {
        NativeContinuationClient.Config withBeatmatch = NativeContinuationClient.Config.fromJson(
            new JSONObject(
                "{\"token\":\"crv_x\",\"allowBeatmatch\":true,\"allowBassHandoff\":true}"
            )
        );
        NativeContinuationClient.Config withoutBeatmatch = NativeContinuationClient.Config.fromJson(
            new JSONObject(
                "{\"token\":\"crv_x\",\"allowBeatmatch\":false,\"allowBassHandoff\":true}"
            )
        );

        assertTrue(withBeatmatch.allowBassHandoff);
        assertFalse(withoutBeatmatch.allowBassHandoff);
    }

    @Test
    public void anEmptyTokenClearsTheConfiguration() throws Exception {
        assertNull(NativeContinuationClient.Config.fromJson(new JSONObject("{\"token\":\"\"}")));
    }

    private static final NativeContinuationClient.Config REFILL_CONFIG =
        new NativeContinuationClient.Config(
            "https://api.example",
            "crv_continuation",
            2_000_000L,
            "radio",
            12_000L,
            false,
            false,
            "balanced",
            true
        );

    @Test
    public void asksToContinueAfterTheLastQueuedEntity() throws Exception {
        JSONObject body = NativeContinuationClient.continuationBody(REFILL_CONFIG, tracks, 10);

        assertEquals("uid-5", body.getString("afterTrackEntityUid"));
        assertEquals(10, body.getInt("limit"));
        assertEquals("balanced", body.getString("delivery"));
        JSONArray recent = body.getJSONArray("recentEntityUids");
        assertEquals(4, recent.length());
        assertEquals("uid-5", recent.getString(0));
        assertEquals("radio", body.getJSONObject("context").getString("source"));
    }

    @Test
    public void buildsNativeTracksAndJoinPlansFromAContinuation() throws Exception {
        String body = new JSONObject()
            .put(
                "tracks",
                new JSONArray().put(
                    new JSONObject()
                        .put("id", "uid-6")
                        .put("entityUid", "uid-6")
                        .put("url", "/api/tracks/by-entity/uid-6/stream?delivery=balanced")
                        .put("title", "Six")
                        .put("artist", "Band")
                        .put("durationMs", 201_500L)
                        .put("source", new JSONObject().put("entity_uid", "uid-6"))
                )
            )
            .put(
                "plans",
                new JSONArray().put(
                    new JSONObject()
                        .put("outgoingTrackEntityUid", "uid-5")
                        .put("incomingTrackEntityUid", "uid-6")
                        .put("plannerVersion", 2)
                        .put("outgoingCueMs", 170_000L)
                )
            )
            .put("exhausted", false)
            .toString();

        NativeContinuationClient.Continuation continuation =
            NativeContinuationClient.parseContinuation(body, REFILL_CONFIG, tracks);

        assertEquals(1, continuation.tracks.size());
        NativeTrack track = continuation.tracks.get(0);
        assertEquals("uid-6", track.id);
        assertEquals(
            "https://api.example/api/tracks/by-entity/uid-6/stream?delivery=balanced",
            track.url
        );
        assertEquals(201_500L, track.durationMs);
        assertEquals("{\"entity_uid\":\"uid-6\"}", continuation.sources.get(0));
        assertEquals(1, continuation.plans.size());
        assertEquals("runtime-5", continuation.plans.get(0).getString("outgoingTrackId"));
        assertEquals("uid-6", continuation.plans.get(0).getString("incomingTrackId"));
        assertFalse(continuation.exhausted);
    }

    @Test
    public void reportsContinuationFailures() {
        RecordingTransport transport = new RecordingTransport();
        NativeContinuationClient client = new NativeContinuationClient(transport);

        transport.response = new NativeContinuationClient.Response(401, "");
        assertEquals(
            NativeContinuationClient.Outcome.UNAUTHORIZED,
            client.fetchContinuation(REFILL_CONFIG, tracks, 10).outcome
        );
        assertEquals("https://api.example/api/playback/continuation", transport.url);
        transport.response = new NativeContinuationClient.Response(500, "");
        assertEquals(
            NativeContinuationClient.Outcome.FAILED,
            client.fetchContinuation(REFILL_CONFIG, tracks, 10).outcome
        );
    }

    @Test
    public void aTokenIsUsableOnlyBeforeItExpires() {
        assertTrue(CONFIG.isUsable(1_999_999L));
        assertFalse(CONFIG.isUsable(2_000_000L));
        assertFalse(
            new NativeContinuationClient.Config("", "crv_x", 2_000_000L, "playlist", 0L, false)
                .isUsable(0L)
        );
    }

    private static NativeTrack track(String id, String entityUid) {
        return new NativeTrack(
            id,
            entityUid,
            "https://api.example/stream/" + id,
            "",
            id,
            "Artist",
            "Album",
            "",
            "",
            180_000L,
            null
        );
    }
}
