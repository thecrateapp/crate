package app.cratemusic.crate;

import androidx.annotation.Nullable;
import com.getcapacitor.JSObject;
import java.util.Objects;

/** Confirmed engine state only; never exposes a future planner technique as active. */
final class NativeMixState {
    final String revision;
    final long executionId;
    final String mode;
    final String phase;
    final boolean bassHandoff;
    final String outgoingTrackId;
    final String incomingTrackId;
    final long durationMs;

    private NativeMixState(String revision, long executionId, String mode, String phase,
        boolean bassHandoff, String outgoingTrackId, String incomingTrackId, long durationMs) {
        this.revision = revision;
        this.executionId = executionId;
        this.mode = mode;
        this.phase = phase;
        this.bassHandoff = bassHandoff;
        this.outgoingTrackId = outgoingTrackId;
        this.incomingTrackId = incomingTrackId;
        this.durationMs = durationMs;
    }

    static NativeMixState mixing(String revision, long executionId,
        NativeTransitionPlan plan, boolean beatmatchEngaged, boolean bassHandoffEngaged) {
        return new NativeMixState(revision, executionId,
            beatmatchEngaged ? "beatmatch" : "crossfade", "mixing",
            beatmatchEngaged && bassHandoffEngaged,
            plan.outgoingTrackId, plan.incomingTrackId, plan.durationMs);
    }

    @Nullable
    static NativeMixState confirmedGapless(String revision, long executionId,
        @Nullable String outgoingTrackId, @Nullable String incomingTrackId,
        int crossfadeMs, boolean mixableAdjacent, boolean repeatOne,
        boolean gaplessPlan, boolean fellBack) {
        if (outgoingTrackId == null || incomingTrackId == null || repeatOne) return null;
        if (crossfadeMs > 0 && mixableAdjacent && !gaplessPlan && !fellBack) return null;
        return new NativeMixState(revision, executionId, "gapless", "idle", false,
            outgoingTrackId, incomingTrackId, 0L);
    }

    JSObject toJson() {
        return new JSObject().put("revision", revision).put("executionId", executionId)
            .put("mode", mode).put("phase", phase).put("bassHandoff", bassHandoff)
            .put("outgoingTrackId", outgoingTrackId).put("incomingTrackId", incomingTrackId)
            .put("durationMs", durationMs);
    }

    @Override
    public boolean equals(Object other) {
        if (!(other instanceof NativeMixState)) return false;
        NativeMixState that = (NativeMixState) other;
        return executionId == that.executionId && bassHandoff == that.bassHandoff
            && durationMs == that.durationMs && Objects.equals(revision, that.revision)
            && mode.equals(that.mode) && phase.equals(that.phase)
            && outgoingTrackId.equals(that.outgoingTrackId)
            && incomingTrackId.equals(that.incomingTrackId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(revision, executionId, mode, phase, bassHandoff,
            outgoingTrackId, incomingTrackId, durationMs);
    }
}
