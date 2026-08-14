package app.cratemusic.crate;

import androidx.annotation.Nullable;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

final class NativeQueueState {
    private final List<NativeTrack> tracks = new ArrayList<>();
    private final List<NativeTransitionPlan> transitionPlans = new ArrayList<>();
    private String revision = "";

    String revision() {
        return revision;
    }

    int size() {
        return tracks.size();
    }

    boolean isEmpty() {
        return tracks.isEmpty();
    }

    List<NativeTrack> snapshot() {
        return Collections.unmodifiableList(new ArrayList<>(tracks));
    }

    @Nullable
    NativeTrack get(int index) {
        return index >= 0 && index < tracks.size() ? tracks.get(index) : null;
    }

    void replace(String requestedRevision, List<NativeTrack> replacement) {
        replace(requestedRevision, replacement, Collections.emptyList());
    }

    void replace(
        String requestedRevision,
        List<NativeTrack> replacement,
        List<NativeTransitionPlan> replacementPlans
    ) {
        revision = valueOrDefault(requestedRevision, UUID.randomUUID().toString());
        tracks.clear();
        transitionPlans.clear();
        if (replacement != null) {
            tracks.addAll(replacement);
        }
        if (replacementPlans != null) {
            transitionPlans.addAll(replacementPlans);
        }
    }

    @Nullable
    NativeTransitionPlan transitionPlanFor(
        String outgoingTrackId,
        String incomingTrackId
    ) {
        if (outgoingTrackId == null || incomingTrackId == null) return null;
        int outgoingIndex = indexOfTrack(outgoingTrackId);
        int incomingIndex = indexOfTrack(incomingTrackId);
        if (
            outgoingIndex < 0 ||
            incomingIndex != outgoingIndex + 1
        ) {
            return null;
        }
        for (NativeTransitionPlan plan : transitionPlans) {
            if (
                outgoingTrackId.equals(plan.outgoingTrackId) &&
                incomingTrackId.equals(plan.incomingTrackId)
            ) {
                return plan;
            }
        }
        return null;
    }

    boolean append(String requestedRevision, List<NativeTrack> additions) {
        if (!acceptsRevision(requestedRevision)) return false;
        if (additions == null || additions.isEmpty()) return true;
        tracks.addAll(additions);
        return true;
    }

    int insert(String requestedRevision, int index, NativeTrack track) {
        if (!acceptsRevision(requestedRevision) || track == null) return -1;
        int safeIndex = Math.max(0, Math.min(index, tracks.size()));
        tracks.add(safeIndex, track);
        transitionPlans.clear();
        return safeIndex;
    }

    boolean remove(String requestedRevision, int index) {
        if (!acceptsRevision(requestedRevision)) return false;
        if (index < 0 || index >= tracks.size()) return false;
        tracks.remove(index);
        transitionPlans.clear();
        return true;
    }

    boolean reorder(String requestedRevision, int fromIndex, int toIndex) {
        if (!acceptsRevision(requestedRevision)) return false;
        if (
            fromIndex < 0 ||
            fromIndex >= tracks.size() ||
            toIndex < 0 ||
            toIndex >= tracks.size()
        ) {
            return false;
        }
        NativeTrack moved = tracks.remove(fromIndex);
        tracks.add(toIndex, moved);
        transitionPlans.clear();
        return true;
    }

    int clampPlaybackIndex(int requestedIndex) {
        if (tracks.isEmpty()) return 0;
        return Math.max(0, Math.min(requestedIndex, tracks.size() - 1));
    }

    private boolean acceptsRevision(String requestedRevision) {
        return (
            requestedRevision == null ||
            requestedRevision.isEmpty() ||
            revision.equals(requestedRevision)
        );
    }

    private int indexOfTrack(String trackId) {
        for (int index = 0; index < tracks.size(); index++) {
            if (trackId.equals(tracks.get(index).id)) return index;
        }
        return -1;
    }

    private static String valueOrDefault(String value, String fallback) {
        return value == null || value.isEmpty() ? fallback : value;
    }
}
