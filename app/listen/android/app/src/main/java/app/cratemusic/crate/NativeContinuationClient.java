package app.cratemusic.crate;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import androidx.annotation.Nullable;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class NativeContinuationClient {
    static final String PLANNER_VERSION = "smart-mix-v2";
    private static final String PLANS_PATH = "/api/playback/transition-plans";
    private static final String CONTINUATION_PATH = "/api/playback/continuation";
    static final int MAX_RECENT_ENTITY_UIDS = 200;
    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int READ_TIMEOUT_MS = 15_000;

    static final class Config {
        final String apiBase;
        final String token;
        final long expiresAtMs;
        final String source;
        final long preferredDurationMs;
        final boolean allowBeatmatch;
        final String delivery;
        final boolean refill;

        Config(
            String apiBase,
            String token,
            long expiresAtMs,
            String source,
            long preferredDurationMs,
            boolean allowBeatmatch
        ) {
            this(apiBase, token, expiresAtMs, source, preferredDurationMs, allowBeatmatch, "", false);
        }

        Config(
            String apiBase,
            String token,
            long expiresAtMs,
            String source,
            long preferredDurationMs,
            boolean allowBeatmatch,
            String delivery,
            boolean refill
        ) {
            this.apiBase = trimTrailingSlash(apiBase);
            this.token = token == null ? "" : token;
            this.expiresAtMs = expiresAtMs;
            this.source = source == null || source.isEmpty() ? "manual" : source;
            this.preferredDurationMs = Math.max(0L, preferredDurationMs);
            this.allowBeatmatch = allowBeatmatch;
            this.delivery = delivery == null || delivery.isEmpty() ? "original" : delivery;
            this.refill = refill;
        }

        @Nullable
        static Config fromJson(JSONObject payload) {
            String token = payload.optString("token", "");
            if (token.isEmpty()) return null;
            return new Config(
                payload.optString("apiBase", ""),
                token,
                payload.optLong("expiresAtMs", 0L),
                payload.optString("source", "manual"),
                payload.optLong("preferredDurationMs", 0L),
                payload.optBoolean("allowBeatmatch", false),
                payload.optString("delivery", ""),
                payload.optBoolean("refill", false)
            );
        }

        boolean isUsable(long nowWallMs) {
            return !apiBase.isEmpty() && !token.isEmpty() && nowWallMs < expiresAtMs;
        }
    }

    interface Transport {
        Response post(String url, String bearerToken, String body) throws IOException;
    }

    static final class Response {
        final int status;
        final String body;

        Response(int status, String body) {
            this.status = status;
            this.body = body;
        }
    }

    enum Outcome {
        PLANNED,
        UNAUTHORIZED,
        FAILED
    }

    static final class Continuation {
        final Outcome outcome;
        final List<NativeTrack> tracks;
        final List<String> sources;
        final List<JSONObject> plans;
        final boolean exhausted;

        Continuation(
            Outcome outcome,
            List<NativeTrack> tracks,
            List<String> sources,
            List<JSONObject> plans,
            boolean exhausted
        ) {
            this.outcome = outcome;
            this.tracks = tracks;
            this.sources = sources;
            this.plans = plans;
            this.exhausted = exhausted;
        }

        static Continuation failed(Outcome outcome) {
            return new Continuation(
                outcome,
                Collections.emptyList(),
                Collections.emptyList(),
                Collections.emptyList(),
                false
            );
        }
    }

    static final class Result {
        final Outcome outcome;
        final List<JSONObject> plans;

        Result(Outcome outcome, List<JSONObject> plans) {
            this.outcome = outcome;
            this.plans = plans;
        }
    }

    private final Transport transport;

    NativeContinuationClient(Transport transport) {
        this.transport = transport;
    }

    Result fetchPlans(
        Config config,
        List<NativeTrack> tracks,
        int fromIndex,
        int edgeCount
    ) {
        try {
            JSONObject body = requestBody(config, tracks, fromIndex, edgeCount);
            if (body.getJSONArray("edges").length() == 0) {
                return new Result(Outcome.PLANNED, Collections.emptyList());
            }
            Response response = transport.post(
                config.apiBase + PLANS_PATH,
                config.token,
                body.toString()
            );
            if (response.status == 401 || response.status == 403) {
                return new Result(Outcome.UNAUTHORIZED, Collections.emptyList());
            }
            if (response.status != 200) {
                return new Result(Outcome.FAILED, Collections.emptyList());
            }
            return new Result(
                Outcome.PLANNED,
                parsePlans(response.body, tracks, fromIndex, edgeCount)
            );
        } catch (IOException | JSONException error) {
            return new Result(Outcome.FAILED, Collections.emptyList());
        }
    }

    Continuation fetchContinuation(Config config, List<NativeTrack> queue, int limit) {
        try {
            Response response = transport.post(
                config.apiBase + CONTINUATION_PATH,
                config.token,
                continuationBody(config, queue, limit).toString()
            );
            if (response.status == 401 || response.status == 403) {
                return Continuation.failed(Outcome.UNAUTHORIZED);
            }
            if (response.status != 200) {
                return Continuation.failed(Outcome.FAILED);
            }
            return parseContinuation(response.body, config, queue);
        } catch (IOException | JSONException error) {
            return Continuation.failed(Outcome.FAILED);
        }
    }

    static JSONObject continuationBody(Config config, List<NativeTrack> queue, int limit)
        throws JSONException {
        JSONArray recent = new JSONArray();
        String after = "";
        for (int index = queue.size() - 1; index >= 0; index--) {
            String entityUid = queue.get(index).entityUid;
            if (entityUid.isEmpty()) continue;
            if (after.isEmpty()) after = entityUid;
            if (recent.length() >= MAX_RECENT_ENTITY_UIDS) break;
            recent.put(entityUid);
        }
        JSONObject body = new JSONObject()
            .put("plannerVersion", PLANNER_VERSION)
            .put("recentEntityUids", recent)
            .put("limit", limit)
            .put("delivery", config.delivery)
            .put("context", edgeContext(config));
        if (!after.isEmpty()) body.put("afterTrackEntityUid", after);
        return body;
    }

    static Continuation parseContinuation(String body, Config config, List<NativeTrack> queue)
        throws JSONException {
        JSONObject response = new JSONObject(body);
        JSONArray rawTracks = response.optJSONArray("tracks");
        List<NativeTrack> tracks = new ArrayList<>();
        List<String> sources = new ArrayList<>();
        if (rawTracks != null) {
            for (int index = 0; index < rawTracks.length(); index++) {
                JSONObject raw = rawTracks.optJSONObject(index);
                if (raw == null) continue;
                String url = raw.optString("url", "");
                if (url.isEmpty()) continue;
                tracks.add(
                    new NativeTrack(
                        raw.optString("id", ""),
                        raw.optString("entityUid", ""),
                        url.startsWith("/") ? config.apiBase + url : url,
                        "",
                        raw.optString("title", "Unknown"),
                        raw.optString("artist", ""),
                        raw.optString("album", ""),
                        "",
                        "",
                        raw.optLong("durationMs", 0L),
                        null
                    )
                );
                JSONObject source = raw.optJSONObject("source");
                sources.add(source == null ? "{}" : source.toString());
            }
        }
        List<NativeTrack> extended = new ArrayList<>(queue);
        extended.addAll(tracks);
        int fromIndex = Math.max(0, queue.size() - 1);
        JSONObject planResponse = new JSONObject()
            .put("plannerVersion", PLANNER_VERSION)
            .put("plans", response.optJSONArray("plans") == null
                ? new JSONArray()
                : response.optJSONArray("plans"));
        List<JSONObject> plans = parsePlans(
            planResponse.toString(),
            extended,
            fromIndex,
            extended.size() - 1 - fromIndex
        );
        return new Continuation(
            Outcome.PLANNED,
            tracks,
            sources,
            plans,
            response.optBoolean("exhausted", false)
        );
    }

    private static JSONObject edgeContext(Config config) throws JSONException {
        return new JSONObject()
            .put("source", config.source)
            .put("automatic", true)
            .put("offline", false)
            .put("preferredDurationMs", config.preferredDurationMs)
            .put("userCueProfile", "default")
            .put("allowBeatmatch", config.allowBeatmatch)
            .put("allowTempoAdjustment", config.allowBeatmatch);
    }

    static JSONObject requestBody(
        Config config,
        List<NativeTrack> tracks,
        int fromIndex,
        int edgeCount
    ) throws JSONException {
        JSONArray edges = new JSONArray();
        for (int index = fromIndex; index < fromIndex + edgeCount; index++) {
            if (index < 0 || index + 1 >= tracks.size()) break;
            NativeTrack outgoing = tracks.get(index);
            NativeTrack incoming = tracks.get(index + 1);
            if (outgoing.entityUid.isEmpty() || incoming.entityUid.isEmpty()) {
                continue;
            }
            JSONObject context = edgeContext(config);
            edges.put(
                new JSONObject()
                    .put("outgoingTrackEntityUid", outgoing.entityUid)
                    .put("incomingTrackEntityUid", incoming.entityUid)
                    .put("context", context)
            );
        }
        return new JSONObject()
            .put("plannerVersion", PLANNER_VERSION)
            .put("edges", edges);
    }

    static List<JSONObject> parsePlans(
        String body,
        List<NativeTrack> tracks,
        int fromIndex,
        int edgeCount
    ) throws JSONException {
        JSONObject response = new JSONObject(body);
        if (!PLANNER_VERSION.equals(response.optString("plannerVersion"))) {
            return Collections.emptyList();
        }
        JSONArray serverPlans = response.optJSONArray("plans");
        if (serverPlans == null) return Collections.emptyList();
        List<JSONObject> plans = new ArrayList<>();
        for (int index = fromIndex; index < fromIndex + edgeCount; index++) {
            if (index < 0 || index + 1 >= tracks.size()) break;
            NativeTrack outgoing = tracks.get(index);
            NativeTrack incoming = tracks.get(index + 1);
            JSONObject plan = findPlan(serverPlans, outgoing.entityUid, incoming.entityUid);
            if (plan == null) continue;
            JSONObject installable = new JSONObject(plan.toString());
            installable.put("outgoingTrackId", outgoing.id);
            installable.put("incomingTrackId", incoming.id);
            plans.add(installable);
        }
        return plans;
    }

    private static JSONObject findPlan(
        JSONArray serverPlans,
        String outgoingEntityUid,
        String incomingEntityUid
    ) {
        if (outgoingEntityUid.isEmpty() || incomingEntityUid.isEmpty()) return null;
        for (int index = 0; index < serverPlans.length(); index++) {
            JSONObject plan = serverPlans.optJSONObject(index);
            if (
                plan != null &&
                outgoingEntityUid.equals(plan.optString("outgoingTrackEntityUid")) &&
                incomingEntityUid.equals(plan.optString("incomingTrackEntityUid"))
            ) {
                return plan;
            }
        }
        return null;
    }

    static Transport httpTransport() {
        return (url, bearerToken, body) -> {
            HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
            try {
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
                connection.setReadTimeout(READ_TIMEOUT_MS);
                connection.setDoOutput(true);
                connection.setRequestProperty("Authorization", "Bearer " + bearerToken);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setRequestProperty("Accept", "application/json");
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(body.getBytes(StandardCharsets.UTF_8));
                }
                int status = connection.getResponseCode();
                InputStream stream = status >= 400
                    ? connection.getErrorStream()
                    : connection.getInputStream();
                return new Response(status, readFully(stream));
            } finally {
                connection.disconnect();
            }
        };
    }

    private static String readFully(InputStream stream) throws IOException {
        if (stream == null) return "";
        try (InputStream input = stream) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = input.read(chunk)) != -1) {
                buffer.write(chunk, 0, read);
            }
            return buffer.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static String trimTrailingSlash(String value) {
        if (value == null) return "";
        String trimmed = value.trim();
        while (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        return trimmed;
    }
}
