package app.cratemusic.crate;

import androidx.annotation.Nullable;
import com.getcapacitor.JSObject;
import java.util.Objects;
import java.util.function.Supplier;
import org.json.JSONObject;

/** Publishes semantic changes, without allocating sequence numbers on progress ticks. */
final class NativeMixStateReporter {
    interface Listener { void onChanged(JSObject payload); }
    private final Listener listener;
    private String revision;
    @Nullable private NativeMixState published;

    NativeMixStateReporter(Listener listener) { this.listener = listener; }

    void publish(String currentRevision, @Nullable NativeMixState state,
        Supplier<JSObject> envelope) {
        if (Objects.equals(revision, currentRevision) && Objects.equals(published, state)) return;
        revision = currentRevision;
        published = state;
        listener.onChanged(envelope.get().put("mixState", state == null ? JSONObject.NULL : state.toJson()));
    }
}
