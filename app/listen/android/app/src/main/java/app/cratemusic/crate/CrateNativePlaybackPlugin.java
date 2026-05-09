package app.cratemusic.crate;

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import org.json.JSONException;
import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(
    name = "CrateNativePlayback",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class CrateNativePlaybackPlugin extends Plugin {
    private CrateNativePlaybackService service;
    private boolean binding = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder binder) {
            CrateNativePlaybackService.LocalBinder localBinder =
                (CrateNativePlaybackService.LocalBinder) binder;
            service = localBinder.getService();
            service.setEventSink((eventName, payload) -> notifyListeners(eventName, payload, true));
            binding = false;
            notifyListeners("ready", service.getSnapshot(), true);
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            if (service != null) {
                service.setEventSink(null);
            }
            service = null;
            binding = false;
        }
    };

    @Override
    public void load() {
        super.load();
        bindPlaybackService();
    }

    @PluginMethod
    public void getState(PluginCall call) {
        if (!ensureService(call)) return;
        runOnMain(call, () -> call.resolve(service.getSnapshot()));
    }

    @PluginMethod
    public void drainEvents(PluginCall call) {
        mainHandler.post(() -> {
            JSObject payload = new JSObject();
            payload.put("events", service == null ? new JSArray() : service.drainEvents());
            call.resolve(payload);
        });
    }

    @PluginMethod
    public void setQueue(PluginCall call) {
        if (!ensureService(call)) return;
        JSArray tracks = call.getArray("tracks");
        List<CrateNativePlaybackService.NativeTrack> parsedTracks;
        try {
            parsedTracks = parseTracks(tracks);
        } catch (JSONException e) {
            call.reject("Invalid tracks payload");
            return;
        }
        runOnMain(call, () -> {
            service.setQueue(
                call.getString("revision", ""),
                parsedTracks,
                call.getInt("currentIndex", 0),
                Math.round(call.getDouble("positionMs", 0.0)),
                call.getBoolean("autoplay", true),
                call.getString("repeat", "off"),
                call.getInt("crossfadeMs", 0),
                (float) call.getDouble("volume", 1.0).doubleValue()
            );
            call.resolve(service.getSnapshot());
        });
    }

    @PluginMethod
    public void appendTracks(PluginCall call) {
        if (!ensureService(call)) return;
        try {
            List<CrateNativePlaybackService.NativeTrack> tracks = parseTracks(call.getArray("tracks"));
            runOnMain(call, () -> {
                service.appendTracks(call.getString("revision", ""), tracks);
                call.resolve(service.getSnapshot());
            });
        } catch (JSONException e) {
            call.reject("Invalid tracks payload");
        }
    }

    @PluginMethod
    public void insertTrack(PluginCall call) {
        if (!ensureService(call)) return;
        try {
            JSONObject track = call.getObject("track");
            CrateNativePlaybackService.NativeTrack parsedTrack = parseTrack(track);
            runOnMain(call, () -> {
                service.insertTrack(call.getString("revision", ""), call.getInt("index", 0), parsedTrack);
                call.resolve(service.getSnapshot());
            });
        } catch (JSONException e) {
            call.reject("Invalid track payload");
        }
    }

    @PluginMethod
    public void removeTrack(PluginCall call) {
        if (!ensureService(call)) return;
        runOnMain(call, () -> {
            service.removeTrack(call.getString("revision", ""), call.getInt("index", -1));
            call.resolve(service.getSnapshot());
        });
    }

    @PluginMethod
    public void reorderTrack(PluginCall call) {
        if (!ensureService(call)) return;
        runOnMain(call, () -> {
            service.reorderTrack(call.getString("revision", ""), call.getInt("fromIndex", -1), call.getInt("toIndex", -1));
            call.resolve(service.getSnapshot());
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        if (!ensureService(call)) return;
        runOnMain(call, () -> {
            service.play();
            call.resolve(service.getSnapshot());
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        if (!ensureService(call)) return;
        runOnMain(call, () -> {
            service.pause();
            call.resolve(service.getSnapshot());
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (!ensureService(call)) return;
        runOnMain(call, () -> {
            service.stopPlayback();
            call.resolve(service.getSnapshot());
        });
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        if (!ensureService(call)) return;
        runOnMain(call, () -> {
            service.seekTo(Math.round(call.getDouble("positionMs", 0.0)));
            call.resolve(service.getSnapshot());
        });
    }

    @PluginMethod
    public void jumpTo(PluginCall call) {
        if (!ensureService(call)) return;
        runOnMain(call, () -> {
            service.jumpTo(call.getInt("index", 0), call.getBoolean("autoplay", true));
            call.resolve(service.getSnapshot());
        });
    }

    @PluginMethod
    public void next(PluginCall call) {
        if (!ensureService(call)) return;
        runOnMain(call, () -> {
            service.next();
            call.resolve(service.getSnapshot());
        });
    }

    @PluginMethod
    public void previous(PluginCall call) {
        if (!ensureService(call)) return;
        runOnMain(call, () -> {
            service.previous();
            call.resolve(service.getSnapshot());
        });
    }

    @PluginMethod
    public void setRepeat(PluginCall call) {
        if (!ensureService(call)) return;
        runOnMain(call, () -> {
            service.setRepeat(call.getString("repeat", "off"));
            call.resolve(service.getSnapshot());
        });
    }

    @PluginMethod
    public void setCrossfadeMs(PluginCall call) {
        if (!ensureService(call)) return;
        runOnMain(call, () -> {
            service.setCrossfadeMs(call.getInt("crossfadeMs", 0));
            call.resolve(service.getSnapshot());
        });
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        if (!ensureService(call)) return;
        runOnMain(call, () -> {
            service.setAppVolume((float) call.getDouble("volume", 1.0).doubleValue());
            call.resolve(service.getSnapshot());
        });
    }

    @PluginMethod
    public void setPlaybackRate(PluginCall call) {
        if (!ensureService(call)) return;
        runOnMain(call, () -> {
            service.setPlaybackRate((float) call.getDouble("rate", 1.0).doubleValue());
            call.resolve(service.getSnapshot());
        });
    }

    @PluginMethod
    public void setEq(PluginCall call) {
        if (!ensureService(call)) return;
        try {
            float[] gains = parseGains(call.getArray("gains"));
            runOnMain(call, () -> {
                service.setEq(call.getBoolean("enabled", false), gains);
                call.resolve(service.getSnapshot());
            });
        } catch (JSONException e) {
            call.reject("Invalid EQ gains payload");
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (service != null) {
            service.setEventSink(null);
        }
        try {
            getContext().unbindService(connection);
        } catch (IllegalArgumentException ignored) {
            // The service may not have been bound if the bridge is torn down early.
        }
        service = null;
        binding = false;
        super.handleOnDestroy();
    }

    private boolean ensureService(PluginCall call) {
        if (service != null) return true;
        bindPlaybackService();
        call.reject("Native playback service is not ready");
        return false;
    }

    private interface MainThreadAction {
        void run();
    }

    private void runOnMain(PluginCall call, MainThreadAction action) {
        mainHandler.post(() -> {
            if (service == null) {
                bindPlaybackService();
                call.reject("Native playback service is not ready");
                return;
            }
            try {
                action.run();
            } catch (RuntimeException e) {
                call.reject("Native playback command failed", e);
            }
        });
    }

    private void bindPlaybackService() {
        if (binding || service != null) return;
        binding = true;
        Intent intent = new Intent(getContext(), CrateNativePlaybackService.class);
        getContext().bindService(intent, connection, Context.BIND_AUTO_CREATE);
    }

    private List<CrateNativePlaybackService.NativeTrack> parseTracks(JSArray tracks)
        throws JSONException {
        List<CrateNativePlaybackService.NativeTrack> parsed = new ArrayList<>();
        if (tracks == null) return parsed;
        for (int i = 0; i < tracks.length(); i++) {
            parsed.add(parseTrack(tracks.getJSONObject(i)));
        }
        return parsed;
    }

    private CrateNativePlaybackService.NativeTrack parseTrack(JSONObject track)
        throws JSONException {
        if (track == null) throw new JSONException("Missing track");
        return new CrateNativePlaybackService.NativeTrack(
            track.optString("id", ""),
            track.optString("url", ""),
            track.optString("title", "Unknown"),
            track.optString("artist", ""),
            track.optString("album", ""),
            track.optString("artwork", ""),
            Math.round(track.optDouble("durationMs", 0.0)),
            parseGains(track.optJSONArray("eqGains"))
        );
    }

    private float[] parseGains(JSArray gains) throws JSONException {
        return parseGains((JSONArray) gains);
    }

    private float[] parseGains(JSONArray gains) throws JSONException {
        if (gains == null) return null;
        float[] parsed = new float[10];
        int limit = Math.min(10, gains.length());
        for (int i = 0; i < limit; i++) {
            parsed[i] = (float) gains.getDouble(i);
        }
        return parsed;
    }
}
