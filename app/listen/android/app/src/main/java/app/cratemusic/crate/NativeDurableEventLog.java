package app.cratemusic.crate;

import androidx.annotation.Nullable;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Play-relevant native events kept on disk until the WebView acknowledges
 * them.
 *
 * <p>While the screen is off the WebView is frozen: native keeps playing and
 * emits trackChanged / playEventCheckpoint, but JS does not run, so the play
 * events never reach JS. If Android then kills the process (paused playback
 * stops the service), those in-memory events are gone and the plays are never
 * recorded. This log survives the process so the next launch can replay them
 * against the queue they belong to.
 *
 * <p>The file is append-only JSON lines; acknowledging rewrites it with the
 * entries still pending. Every entry carries its {@code nativeSequence}, which
 * is also what JS acknowledges.
 */
final class NativeDurableEventLog {
    static final String TRACK_CHANGED = "trackChanged";
    static final String PLAY_EVENT_CHECKPOINT = "playEventCheckpoint";

    private static final String EVENT_KEY = "event";
    private static final String PAYLOAD_KEY = "payload";
    private static final String SEQUENCE_KEY = "nativeSequence";

    private static final class Entry {
        final long sequence;
        final String eventName;
        final JSONObject payload;

        Entry(long sequence, String eventName, JSONObject payload) {
            this.sequence = sequence;
            this.eventName = eventName;
            this.payload = payload;
        }
    }

    private final File file;
    private final int maxEntries;
    private final List<Entry> entries = new ArrayList<>();

    NativeDurableEventLog(File file, int maxEntries) {
        this.file = file;
        this.maxEntries = Math.max(1, maxEntries);
        load();
    }

    static boolean isDurable(String eventName) {
        return TRACK_CHANGED.equals(eventName) || PLAY_EVENT_CHECKPOINT.equals(eventName);
    }

    synchronized void append(String eventName, JSONObject payload) {
        if (!isDurable(eventName) || payload == null) return;
        long sequence = payload.optLong(SEQUENCE_KEY, 0L);
        if (sequence <= 0L) return;
        JSONObject copy;
        try {
            copy = new JSONObject(payload.toString());
        } catch (JSONException error) {
            return;
        }
        Entry entry = new Entry(sequence, eventName, copy);
        entries.add(entry);
        if (trim()) {
            rewrite();
            return;
        }
        String line = toLine(entry);
        if (line != null) write(line, true);
    }

    /** Drops every entry up to and including {@code sequence}. */
    synchronized void acknowledge(long sequence) {
        if (sequence <= 0L || entries.isEmpty()) return;
        boolean removed = entries.removeIf(entry -> entry.sequence <= sequence);
        if (removed) rewrite();
    }

    synchronized JSONArray pendingEvents() {
        JSONArray events = new JSONArray();
        for (Entry entry : entries) {
            JSONObject event = new JSONObject();
            try {
                event.put(EVENT_KEY, entry.eventName);
                event.put(PAYLOAD_KEY, entry.payload);
            } catch (JSONException error) {
                continue;
            }
            events.put(event);
        }
        return events;
    }

    synchronized long maxSequence() {
        long max = 0L;
        for (Entry entry : entries) max = Math.max(max, entry.sequence);
        return max;
    }

    synchronized int size() {
        return entries.size();
    }

    // Dropping a checkpoint only loses some listened seconds; dropping a
    // trackChanged would merge two plays into one, so checkpoints go first.
    // Trimming to a low-water mark keeps a full log from rewriting the file
    // on every append.
    private boolean trim() {
        if (entries.size() <= maxEntries) return false;
        int target = maxEntries - maxEntries / 10;
        boolean trimmed = false;
        while (entries.size() > target) {
            int victim = 0;
            for (int index = 0; index < entries.size(); index++) {
                if (PLAY_EVENT_CHECKPOINT.equals(entries.get(index).eventName)) {
                    victim = index;
                    break;
                }
            }
            entries.remove(victim);
            trimmed = true;
        }
        return trimmed;
    }

    private void load() {
        if (!file.exists()) return;
        boolean corrupt = false;
        try (
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8)
            )
        ) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.trim().isEmpty()) continue;
                Entry entry = fromLine(line);
                if (entry == null) {
                    corrupt = true;
                    continue;
                }
                entries.add(entry);
            }
        } catch (IOException error) {
            entries.clear();
            corrupt = true;
        }
        // Rewriting drops a torn line so the next append starts on a clean line.
        if (trim() || corrupt) rewrite();
    }

    private void rewrite() {
        StringBuilder content = new StringBuilder();
        for (Entry entry : entries) {
            String line = toLine(entry);
            if (line != null) content.append(line);
        }
        write(content.toString(), false);
    }

    private void write(String content, boolean append) {
        File parent = file.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) return;
        try (
            Writer writer = new OutputStreamWriter(
                new FileOutputStream(file, append),
                StandardCharsets.UTF_8
            )
        ) {
            writer.write(content);
        } catch (IOException ignored) {
            // Durability is best effort: the in-memory log still serves this process.
        }
    }

    @Nullable
    private static String toLine(Entry entry) {
        JSONObject line = new JSONObject();
        try {
            line.put(EVENT_KEY, entry.eventName);
            line.put(PAYLOAD_KEY, entry.payload);
        } catch (JSONException error) {
            return null;
        }
        return line.toString() + "\n";
    }

    // A torn last line (process killed mid-write) is skipped, not fatal.
    @Nullable
    private static Entry fromLine(String line) {
        if (line == null || line.trim().isEmpty()) return null;
        try {
            JSONObject json = new JSONObject(line);
            String eventName = json.optString(EVENT_KEY, "");
            JSONObject payload = json.optJSONObject(PAYLOAD_KEY);
            if (!isDurable(eventName) || payload == null) return null;
            long sequence = payload.optLong(SEQUENCE_KEY, 0L);
            if (sequence <= 0L) return null;
            return new Entry(sequence, eventName, payload);
        } catch (JSONException error) {
            return null;
        }
    }
}
