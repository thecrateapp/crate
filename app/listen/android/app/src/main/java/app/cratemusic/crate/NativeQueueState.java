package app.cratemusic.crate;

import androidx.annotation.Nullable;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

final class NativeQueueState {
    private final List<NativeTrack> tracks = new ArrayList<>();
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
        revision = valueOrDefault(requestedRevision, UUID.randomUUID().toString());
        tracks.clear();
        if (replacement != null) {
            tracks.addAll(replacement);
        }
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
        return safeIndex;
    }

    boolean remove(String requestedRevision, int index) {
        if (!acceptsRevision(requestedRevision)) return false;
        if (index < 0 || index >= tracks.size()) return false;
        tracks.remove(index);
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

    private static String valueOrDefault(String value, String fallback) {
        return value == null || value.isEmpty() ? fallback : value;
    }
}
