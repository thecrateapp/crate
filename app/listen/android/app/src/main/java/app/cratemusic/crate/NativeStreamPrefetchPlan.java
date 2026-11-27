package app.cratemusic.crate;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Which queue entries to download into the stream cache: the current track
 * and the next one always, and one more on an unmetered network. With those on
 * disk, a dropped connection does not stop playback for a track or two.
 */
final class NativeStreamPrefetchPlan {
    static final int ALWAYS = 2;
    static final int UNMETERED_EXTRA = 1;

    private NativeStreamPrefetchPlan() {}

    static <T> List<T> select(List<T> queue, int currentIndex, boolean unmetered) {
        if (queue == null || currentIndex < 0 || currentIndex >= queue.size()) {
            return Collections.emptyList();
        }
        int count = ALWAYS + (unmetered ? UNMETERED_EXTRA : 0);
        int end = Math.min(queue.size(), currentIndex + count);
        return new ArrayList<>(queue.subList(currentIndex, end));
    }
}
