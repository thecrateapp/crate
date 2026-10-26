package app.cratemusic.crate;

import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.util.UnstableApi;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@OptIn(markerClass = UnstableApi.class)
final class NativePlaybackTelemetry {
    interface EventSink {
        void emit(String eventName, JSObject payload);
    }

    private final int maxBufferedEvents;
    private final List<BufferedEvent> bufferedEvents = new ArrayList<>();
    @Nullable
    private EventSink eventSink;

    NativePlaybackTelemetry(int maxBufferedEvents) {
        this.maxBufferedEvents = Math.max(1, maxBufferedEvents);
    }

    void setEventSink(@Nullable EventSink sink) {
        eventSink = sink;
    }

    boolean hasEventSink() {
        return eventSink != null;
    }

    JSArray drain() {
        JSArray events = new JSArray();
        for (BufferedEvent bufferedEvent : bufferedEvents) {
            JSObject event = new JSObject();
            event.put("event", bufferedEvent.eventName);
            event.put("payload", bufferedEvent.payload);
            events.put(event);
        }
        bufferedEvents.clear();
        return events;
    }

    int bufferedEventCount() {
        return bufferedEvents.size();
    }

    List<String> bufferedEventNames() {
        List<String> names = new ArrayList<>();
        for (BufferedEvent event : bufferedEvents) {
            names.add(event.eventName);
        }
        return Collections.unmodifiableList(names);
    }

    void emit(String eventName, JSObject payload) {
        if (eventSink != null) {
            eventSink.emit(eventName, payload);
            return;
        }

        BufferedEvent event = new BufferedEvent(eventName, payload);
        if ("positionChanged".equals(eventName)) {
            bufferLatestPositionEvent(event);
            return;
        }
        bufferEvent(event);
    }

    private void bufferLatestPositionEvent(BufferedEvent event) {
        CrateNativePlaybackService.coalesceLatestPositionEvent(
            bufferedEvents,
            event,
            candidate -> "positionChanged".equals(candidate.eventName)
        );
        trimBufferedEvents();
    }

    private void bufferEvent(BufferedEvent event) {
        bufferedEvents.add(event);
        trimBufferedEvents();
    }

    // Without a WebView the buffer fills with play checkpoints. Dropping the
    // oldest checkpoint first only loses some listened seconds, while
    // dropping a trackChanged would merge two plays into one.
    private void trimBufferedEvents() {
        while (bufferedEvents.size() > maxBufferedEvents) {
            int checkpoint = oldestCheckpointIndex();
            bufferedEvents.remove(checkpoint >= 0 ? checkpoint : 0);
        }
    }

    private int oldestCheckpointIndex() {
        for (int index = 0; index < bufferedEvents.size(); index++) {
            if ("playEventCheckpoint".equals(bufferedEvents.get(index).eventName)) {
                return index;
            }
        }
        return -1;
    }

    private static final class BufferedEvent {
        final String eventName;
        final JSObject payload;

        BufferedEvent(String eventName, JSObject payload) {
            this.eventName = eventName;
            this.payload = payload;
        }
    }
}
