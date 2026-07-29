package app.cratemusic.crate;

import androidx.annotation.Nullable;

import org.json.JSONObject;

import java.util.Locale;

final class NativeTransitionPlan {
    static final int SUPPORTED_PLANNER_VERSION = 1;
    static final float MIN_TEMPO_RATIO = 0.94f;
    static final float MAX_TEMPO_RATIO = 1.06f;

    enum Mode {
        GAPLESS,
        ADAPTIVE,
        BEATMATCH
    }

    final int plannerVersion;
    final String outgoingTrackId;
    final String incomingTrackId;
    final Mode mode;
    final long durationMs;
    final long outgoingCueMs;
    final long incomingCueMs;
    final float incomingTempoRatio;
    final long beatPhaseOffsetMs;
    final float handoffProgress;
    final float outgoingGainDb;
    final float incomingGainDb;
    final String curve;
    final String bassHandoff;
    final float confidence;
    @Nullable
    final String fallbackReason;

    private NativeTransitionPlan(
        int plannerVersion,
        String outgoingTrackId,
        String incomingTrackId,
        Mode mode,
        long durationMs,
        long outgoingCueMs,
        long incomingCueMs,
        float incomingTempoRatio,
        long beatPhaseOffsetMs,
        float handoffProgress,
        float outgoingGainDb,
        float incomingGainDb,
        String curve,
        String bassHandoff,
        float confidence,
        @Nullable String fallbackReason
    ) {
        this.plannerVersion = plannerVersion;
        this.outgoingTrackId = outgoingTrackId;
        this.incomingTrackId = incomingTrackId;
        this.mode = mode;
        this.durationMs = durationMs;
        this.outgoingCueMs = outgoingCueMs;
        this.incomingCueMs = incomingCueMs;
        this.incomingTempoRatio = incomingTempoRatio;
        this.beatPhaseOffsetMs = beatPhaseOffsetMs;
        this.handoffProgress = handoffProgress;
        this.outgoingGainDb = outgoingGainDb;
        this.incomingGainDb = incomingGainDb;
        this.curve = curve;
        this.bassHandoff = bassHandoff;
        this.confidence = confidence;
        this.fallbackReason = fallbackReason;
    }

    static NativeTransitionPlan fromJson(
        @Nullable JSONObject payload,
        String expectedOutgoingTrackId,
        String expectedIncomingTrackId,
        long fallbackDurationMs
    ) {
        if (payload == null) {
            return safeFallback(
                expectedOutgoingTrackId,
                expectedIncomingTrackId,
                fallbackDurationMs,
                "missing_plan"
            );
        }

        int plannerVersion = payload.optInt("plannerVersion", -1);
        if (plannerVersion != SUPPORTED_PLANNER_VERSION) {
            throw new IllegalArgumentException(
                "Unsupported Smart Mix planner version: " + plannerVersion
            );
        }

        String outgoingTrackId = payload.optString("outgoingTrackId", "");
        String incomingTrackId = payload.optString("incomingTrackId", "");
        if (
            !expectedOutgoingTrackId.equals(outgoingTrackId) ||
            !expectedIncomingTrackId.equals(incomingTrackId)
        ) {
            throw new IllegalArgumentException(
                "Transition plan does not match its adjacent queue edge"
            );
        }

        Mode mode = parseMode(payload.optString("mode", ""));
        long durationMs = nonNegativeMs(
            "durationMs",
            payload.optLong("durationMs", -1L)
        );
        long outgoingCueMs = nonNegativeMs(
            "outgoingCueMs",
            payload.optLong("outgoingCueMs", 0L)
        );
        long incomingCueMs = nonNegativeMs(
            "incomingCueMs",
            payload.optLong("incomingCueMs", 0L)
        );
        long beatPhaseOffsetMs = nonNegativeMs(
            "beatPhaseOffsetMs",
            payload.optLong("beatPhaseOffsetMs", 0L)
        );
        float tempoRatio = finiteFloat(
            "incomingTempoRatio",
            payload.optDouble("incomingTempoRatio", 1.0)
        );
        if (tempoRatio < MIN_TEMPO_RATIO || tempoRatio > MAX_TEMPO_RATIO) {
            throw new IllegalArgumentException(
                "incomingTempoRatio is outside the supported range"
            );
        }
        float handoffProgress = unitFloat(
            "handoffProgress",
            payload.optDouble("handoffProgress", 0.5)
        );
        float confidence = unitFloat(
            "confidence",
            payload.optDouble("confidence", 0.0)
        );
        float outgoingGainDb = finiteFloat(
            "outgoingGainDb",
            payload.optDouble("outgoingGainDb", 0.0)
        );
        float incomingGainDb = finiteFloat(
            "incomingGainDb",
            payload.optDouble("incomingGainDb", 0.0)
        );
        String curve = payload.optString("curve", "equal-power");
        if (!"equal-power".equals(curve)) {
            throw new IllegalArgumentException(
                "Unsupported transition curve: " + curve
            );
        }
        String bassHandoff = payload.optString("bassHandoff", "none");
        if (
            !"none".equals(bassHandoff) &&
            !"balanced".equals(bassHandoff)
        ) {
            throw new IllegalArgumentException(
                "Unsupported bass handoff: " + bassHandoff
            );
        }

        String fallbackReason = payload.optString("fallbackReason", "");
        return new NativeTransitionPlan(
            plannerVersion,
            outgoingTrackId,
            incomingTrackId,
            mode,
            durationMs,
            outgoingCueMs,
            incomingCueMs,
            tempoRatio,
            beatPhaseOffsetMs,
            handoffProgress,
            outgoingGainDb,
            incomingGainDb,
            curve,
            bassHandoff,
            confidence,
            fallbackReason.isEmpty() ? null : fallbackReason
        );
    }

    static NativeTransitionPlan safeFallback(
        String outgoingTrackId,
        String incomingTrackId,
        long durationMs,
        String reason
    ) {
        return new NativeTransitionPlan(
            SUPPORTED_PLANNER_VERSION,
            outgoingTrackId,
            incomingTrackId,
            durationMs > 0 ? Mode.ADAPTIVE : Mode.GAPLESS,
            Math.max(0L, durationMs),
            0L,
            0L,
            1.0f,
            0L,
            0.5f,
            0.0f,
            0.0f,
            "equal-power",
            "none",
            0.0f,
            reason
        );
    }

    private static Mode parseMode(String value) {
        try {
            return Mode.valueOf(value.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException(
                "Unsupported transition mode: " + value,
                error
            );
        }
    }

    private static long nonNegativeMs(String field, long value) {
        if (value < 0L) {
            throw new IllegalArgumentException(field + " must not be negative");
        }
        return value;
    }

    private static float unitFloat(String field, double value) {
        float parsed = finiteFloat(field, value);
        if (parsed < 0.0f || parsed > 1.0f) {
            throw new IllegalArgumentException(
                field + " must be between zero and one"
            );
        }
        return parsed;
    }

    private static float finiteFloat(String field, double value) {
        if (!Double.isFinite(value)) {
            throw new IllegalArgumentException(field + " must be finite");
        }
        return (float) value;
    }
}
