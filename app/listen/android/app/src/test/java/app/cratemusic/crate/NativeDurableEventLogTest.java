package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class NativeDurableEventLogTest {
    @Rule
    public TemporaryFolder folder = new TemporaryFolder();

    private static JSONObject payload(long sequence, int index) throws Exception {
        JSONObject payload = new JSONObject();
        payload.put("revision", "queue-a");
        payload.put("nativeSequence", sequence);
        payload.put("index", index);
        payload.put("trackId", "track-" + index);
        payload.put("positionMs", 5000L);
        return payload;
    }

    private File logFile() {
        return new File(folder.getRoot(), "events.jsonl");
    }

    @Test
    public void keepsOnlyPlayRelevantEvents() throws Exception {
        NativeDurableEventLog log = new NativeDurableEventLog(logFile(), 10);

        log.append("trackChanged", payload(1, 1));
        log.append("playEventCheckpoint", payload(2, 1));
        log.append("positionChanged", payload(3, 1));
        log.append("stateChanged", payload(4, 1));

        assertEquals(2, log.size());
        assertTrue(NativeDurableEventLog.isDurable("trackChanged"));
        assertFalse(NativeDurableEventLog.isDurable("positionChanged"));
    }

    @Test
    public void survivesAProcessRestartInOrder() throws Exception {
        NativeDurableEventLog first = new NativeDurableEventLog(logFile(), 10);
        first.append("playEventCheckpoint", payload(7, 0));
        first.append("trackChanged", payload(8, 1));

        NativeDurableEventLog restarted = new NativeDurableEventLog(logFile(), 10);
        JSONArray events = restarted.pendingEvents();

        assertEquals(2, events.length());
        assertEquals("playEventCheckpoint", events.getJSONObject(0).getString("event"));
        assertEquals("trackChanged", events.getJSONObject(1).getString("event"));
        assertEquals(
            1,
            events.getJSONObject(1).getJSONObject("payload").getInt("index")
        );
        assertEquals(8L, restarted.maxSequence());
    }

    @Test
    public void acknowledgedEventsAreNotReplayedAfterRestart() throws Exception {
        NativeDurableEventLog log = new NativeDurableEventLog(logFile(), 10);
        log.append("trackChanged", payload(1, 1));
        log.append("playEventCheckpoint", payload(2, 1));
        log.append("trackChanged", payload(3, 2));

        log.acknowledge(2);

        NativeDurableEventLog restarted = new NativeDurableEventLog(logFile(), 10);
        assertEquals(1, restarted.size());
        assertEquals(
            3L,
            restarted.pendingEvents().getJSONObject(0).getJSONObject("payload")
                .getLong("nativeSequence")
        );
    }

    @Test
    public void dropsCheckpointsBeforeTrackChangesWhenFull() throws Exception {
        NativeDurableEventLog log = new NativeDurableEventLog(logFile(), 3);
        log.append("trackChanged", payload(1, 1));
        log.append("playEventCheckpoint", payload(2, 1));
        log.append("trackChanged", payload(3, 2));
        log.append("trackChanged", payload(4, 3));

        JSONArray events = new NativeDurableEventLog(logFile(), 3).pendingEvents();

        assertEquals(3, events.length());
        for (int index = 0; index < events.length(); index++) {
            assertEquals("trackChanged", events.getJSONObject(index).getString("event"));
        }
    }

    @Test
    public void skipsATornLastLine() throws Exception {
        NativeDurableEventLog log = new NativeDurableEventLog(logFile(), 10);
        log.append("trackChanged", payload(1, 1));
        appendRaw("{\"event\":\"trackChanged\",\"payload\":{\"nativeSeq");

        NativeDurableEventLog restarted = new NativeDurableEventLog(logFile(), 10);
        assertEquals(1, restarted.size());

        restarted.append("trackChanged", payload(2, 2));
        assertEquals(2, new NativeDurableEventLog(logFile(), 10).size());
    }

    @Test
    public void ignoresEventsWithoutASequence() throws Exception {
        NativeDurableEventLog log = new NativeDurableEventLog(logFile(), 10);
        JSONObject unsequenced = payload(1, 1);
        unsequenced.remove("nativeSequence");

        log.append("trackChanged", unsequenced);

        assertEquals(0, log.size());
    }

    private void appendRaw(String text) throws IOException {
        try (FileOutputStream stream = new FileOutputStream(logFile(), true)) {
            stream.write(text.getBytes(StandardCharsets.UTF_8));
        }
    }
}
