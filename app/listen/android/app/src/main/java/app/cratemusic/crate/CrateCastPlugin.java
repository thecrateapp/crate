package app.cratemusic.crate;

import android.Manifest;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.ViewGroup;

import androidx.mediarouter.app.MediaRouteButton;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.cast.MediaInfo;
import com.google.android.gms.cast.MediaLoadRequestData;
import com.google.android.gms.cast.MediaMetadata;
import com.google.android.gms.cast.MediaSeekOptions;
import com.google.android.gms.cast.framework.CastButtonFactory;
import com.google.android.gms.cast.framework.CastContext;
import com.google.android.gms.cast.framework.CastSession;
import com.google.android.gms.cast.framework.CastState;
import com.google.android.gms.cast.framework.SessionManager;
import com.google.android.gms.cast.framework.SessionManagerListener;
import com.google.android.gms.cast.framework.media.RemoteMediaClient;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.common.images.WebImage;

import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "CrateCast",
    permissions = {
        @Permission(alias = "castLocation", strings = { Manifest.permission.ACCESS_FINE_LOCATION }),
        @Permission(alias = "castNearbyWifi", strings = { Manifest.permission.NEARBY_WIFI_DEVICES })
    }
)
public class CrateCastPlugin extends Plugin {
    private static final String TAG = "CrateCastPlugin";
    private static final long CAST_REQUEST_TIMEOUT_MS = 60_000L;
    private static final String PERMISSION_CAST_LOCATION = "castLocation";
    private static final String PERMISSION_CAST_NEARBY_WIFI = "castNearbyWifi";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private PluginCall pendingRequestCall;
    private JSObject pendingMediaPayload;
    private Runnable pendingRequestTimeout;
    private MediaRouteButton routeButton;

    private final SessionManagerListener<CastSession> sessionListener =
        new SessionManagerListener<CastSession>() {
            @Override
            public void onSessionStarted(CastSession session, String sessionId) {
                loadPendingMedia(session);
            }

            @Override
            public void onSessionResumed(CastSession session, boolean wasSuspended) {
                loadPendingMedia(session);
            }

            @Override
            public void onSessionEnded(CastSession session, int error) {
                notifyListeners("sessionChanged", castStatePayload(false), true);
            }

            @Override
            public void onSessionStarting(CastSession session) {}

            @Override
            public void onSessionStartFailed(CastSession session, int error) {
                rejectPending("Could not start Cast session.");
            }

            @Override
            public void onSessionEnding(CastSession session) {}

            @Override
            public void onSessionResuming(CastSession session, String sessionId) {}

            @Override
            public void onSessionResumeFailed(CastSession session, int error) {
                rejectPending("Could not resume Cast session.");
            }

            @Override
            public void onSessionSuspended(CastSession session, int reason) {}
        };

    @Override
    public void load() {
        super.load();
        try {
            castContext().getSessionManager().addSessionManagerListener(
                sessionListener,
                CastSession.class
            );
        } catch (RuntimeException error) {
            Log.w(TAG, "Could not register Cast session listener.", error);
        }
    }

    @Override
    protected void handleOnDestroy() {
        try {
            castContext().getSessionManager().removeSessionManagerListener(
                sessionListener,
                CastSession.class
            );
        } catch (RuntimeException error) {
            Log.w(TAG, "Could not remove Cast session listener.", error);
        }
        rejectPending("Cast bridge was destroyed before playback started.");
        removeRouteButton();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void getCapabilities(PluginCall call) {
        mainHandler.post(() -> {
            if (!hasGooglePlayServices()) {
                call.resolve(unavailable("Google Play services are unavailable."));
                return;
            }
            try {
                CastContext context = castContext();
                CastSession session = currentSession(context);
                boolean active = session != null && session.isConnected();
                int state = context.getCastState();
                JSObject payload = new JSObject();
                payload.put("platform", "native");
                payload.put("visible", true);
                payload.put("available", active || state != CastState.NO_DEVICES_AVAILABLE);
                payload.put("activeSession", active);
                payload.put("targetName", active ? session.getCastDevice().getFriendlyName() : null);
                if (!active && state == CastState.NO_DEVICES_AVAILABLE) {
                    payload.put("reason", "No Cast receivers found on this network.");
                }
                call.resolve(payload);
            } catch (RuntimeException error) {
                Log.w(TAG, "Could not read Cast capabilities.", error);
                call.resolve(unavailable("Google Cast is unavailable in this build."));
            }
        });
    }

    @PluginMethod
    public void requestSession(PluginCall call) {
        mainHandler.post(() -> {
            if (!hasGooglePlayServices()) {
                call.resolve(result(false, "Google Play services are unavailable."));
                return;
            }
            if (!ensureCastDiscoveryPermission(call)) return;
            if (pendingRequestCall != null) {
                call.resolve(result(false, "Another Cast request is already pending."));
                return;
            }
            try {
                pendingRequestCall = call;
                pendingMediaPayload = call.getData();
                schedulePendingTimeout(call);
                CastSession session = currentSession(castContext());
                if (session != null && session.isConnected()) {
                    loadPendingMedia(session);
                    return;
                }
                showCastPicker();
            } catch (RuntimeException error) {
                Log.w(TAG, "Could not request Cast session.", error);
                rejectPending("Google Cast is unavailable in this build.");
            }
        });
    }

    @PermissionCallback
    private void requestSessionAfterPermission(PluginCall call) {
        if (!hasCastDiscoveryPermission()) {
            call.resolve(result(false, "Cast discovery permission was denied."));
            return;
        }
        requestSession(call);
    }

    @PluginMethod
    public void play(PluginCall call) {
        runWithRemoteClient(call, remoteClient -> remoteClient.play());
    }

    @PluginMethod
    public void pause(PluginCall call) {
        runWithRemoteClient(call, remoteClient -> remoteClient.pause());
    }

    @PluginMethod
    public void seek(PluginCall call) {
        long positionMs = Math.max(
            0,
            Math.round(call.getDouble("currentTime", 0.0) * 1000)
        );
        runWithRemoteClient(
            call,
            remoteClient -> remoteClient.seek(
                new MediaSeekOptions.Builder()
                    .setPosition(positionMs)
                    .build()
            )
        );
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        double volume = Math.max(0.0, Math.min(1.0, call.getDouble("volume", 1.0)));
        runWithRemoteClient(call, remoteClient -> remoteClient.setStreamVolume(volume));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        runWithRemoteClient(call, remoteClient -> remoteClient.stop());
    }

    private CastContext castContext() {
        return CastContext.getSharedInstance(getContext());
    }

    private CastSession currentSession(CastContext context) {
        SessionManager manager = context.getSessionManager();
        return manager == null ? null : manager.getCurrentCastSession();
    }

    private boolean hasGooglePlayServices() {
        return GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(getContext())
            == ConnectionResult.SUCCESS;
    }

    private boolean ensureCastDiscoveryPermission(PluginCall call) {
        if (hasCastDiscoveryPermission()) return true;
        requestPermissionForAlias(requiredCastDiscoveryPermissionAlias(), call, "requestSessionAfterPermission");
        return false;
    }

    private boolean hasCastDiscoveryPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return getPermissionState(PERMISSION_CAST_NEARBY_WIFI) == PermissionState.GRANTED;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return getPermissionState(PERMISSION_CAST_LOCATION) == PermissionState.GRANTED;
        }
        return true;
    }

    private String requiredCastDiscoveryPermissionAlias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            ? PERMISSION_CAST_NEARBY_WIFI
            : PERMISSION_CAST_LOCATION;
    }

    private JSObject unavailable(String reason) {
        JSObject payload = new JSObject();
        payload.put("platform", "native");
        payload.put("visible", true);
        payload.put("available", false);
        payload.put("activeSession", false);
        payload.put("reason", reason);
        return payload;
    }

    private JSObject result(boolean ok, String message) {
        JSObject payload = new JSObject();
        payload.put("ok", ok);
        if (message != null) payload.put("message", message);
        return payload;
    }

    private JSObject castStatePayload(boolean active) {
        JSObject payload = new JSObject();
        payload.put("active", active);
        return payload;
    }

    private void showCastPicker() {
        if (getActivity() == null) {
            rejectPending("Could not open the Cast device picker.");
            return;
        }
        removeRouteButton();
        routeButton = new MediaRouteButton(getActivity());
        routeButton.setVisibility(android.view.View.INVISIBLE);
        getActivity().addContentView(
            routeButton,
            new ViewGroup.LayoutParams(1, 1)
        );
        CastButtonFactory.setUpMediaRouteButton(getContext(), routeButton);
        routeButton.performClick();
        mainHandler.postDelayed(this::removeRouteButton, 1_000L);
    }

    private void loadPendingMedia(CastSession session) {
        if (pendingRequestCall == null || pendingMediaPayload == null) return;
        PluginCall call = pendingRequestCall;
        try {
            RemoteMediaClient remoteClient = session.getRemoteMediaClient();
            if (remoteClient == null) {
                rejectPending("Cast receiver is not ready.");
                return;
            }
            MediaLoadRequestData requestData = buildLoadRequest(pendingMediaPayload);
            remoteClient.load(requestData).setResultCallback(mediaResult -> mainHandler.post(() -> {
                if (pendingRequestCall != call) return;
                if (mediaResult.getStatus().isSuccess()) {
                    call.resolve(result(true, "Casting started."));
                    clearPending();
                    notifyListeners("sessionChanged", castStatePayload(true), true);
                    return;
                }
                rejectPending("Could not load Cast media.");
            }));
        } catch (RuntimeException | JSONException error) {
            Log.w(TAG, "Could not load Cast media.", error);
            rejectPending("Could not load Cast media.");
        }
    }

    private MediaLoadRequestData buildLoadRequest(JSObject payload) throws JSONException {
        String streamUrl = payload.optString("streamUrl", "");
        String contentType = payload.optString("contentType", "audio/mpeg");
        String title = payload.optString("title", "Crate");
        String artist = payload.optString("artist", "");
        String album = payload.optString("album", "");
        String artworkUrl = payload.optString("artworkUrl", "");
        String metadataUrl = payload.optString("metadataUrl", "");
        double duration = payload.optDouble("duration", 0.0);
        double currentTime = payload.optDouble("currentTime", 0.0);

        MediaMetadata metadata = new MediaMetadata(MediaMetadata.MEDIA_TYPE_MUSIC_TRACK);
        metadata.putString(MediaMetadata.KEY_TITLE, title);
        metadata.putString(MediaMetadata.KEY_ARTIST, artist);
        metadata.putString(MediaMetadata.KEY_ALBUM_TITLE, album);
        if (!artworkUrl.isEmpty()) {
            metadata.addImage(new WebImage(Uri.parse(artworkUrl)));
        }

        JSONObject customData = new JSONObject();
        customData.put("metadataUrl", metadataUrl);

        MediaInfo.Builder mediaInfoBuilder = new MediaInfo.Builder(streamUrl)
            .setContentType(contentType)
            .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
            .setMetadata(metadata)
            .setCustomData(customData);
        if (duration > 0) {
            mediaInfoBuilder.setStreamDuration(Math.round(duration * 1000));
        }

        return new MediaLoadRequestData.Builder()
            .setMediaInfo(mediaInfoBuilder.build())
            .setAutoplay(true)
            .setCurrentTime(Math.max(0, Math.round(currentTime * 1000)))
            .build();
    }

    private void rejectPending(String message) {
        PluginCall call = pendingRequestCall;
        clearPending();
        if (call != null) {
            call.resolve(result(false, message));
        }
    }

    private void clearPending() {
        clearPendingTimeout();
        pendingRequestCall = null;
        pendingMediaPayload = null;
        removeRouteButton();
    }

    private void schedulePendingTimeout(PluginCall call) {
        clearPendingTimeout();
        pendingRequestTimeout = () -> {
            if (pendingRequestCall == call) {
                rejectPending("Cast session was not started.");
            }
        };
        mainHandler.postDelayed(pendingRequestTimeout, CAST_REQUEST_TIMEOUT_MS);
    }

    private void clearPendingTimeout() {
        if (pendingRequestTimeout == null) return;
        mainHandler.removeCallbacks(pendingRequestTimeout);
        pendingRequestTimeout = null;
    }

    private void removeRouteButton() {
        if (routeButton == null) return;
        try {
            ViewGroup parent = (ViewGroup) routeButton.getParent();
            if (parent != null) parent.removeView(routeButton);
        } catch (RuntimeException error) {
            Log.w(TAG, "Could not remove Cast route button.", error);
        }
        routeButton = null;
    }

    private interface RemoteClientAction {
        void run(RemoteMediaClient remoteClient);
    }

    private void runWithRemoteClient(PluginCall call, RemoteClientAction action) {
        mainHandler.post(() -> {
            try {
                CastSession session = currentSession(castContext());
                RemoteMediaClient remoteClient =
                    session == null ? null : session.getRemoteMediaClient();
                if (remoteClient == null) {
                    call.resolve(result(false, "No active Cast media session."));
                    return;
                }
                action.run(remoteClient);
                call.resolve(result(true, null));
            } catch (RuntimeException error) {
                Log.w(TAG, "Cast control failed.", error);
                call.resolve(result(false, "Cast control failed."));
            }
        });
    }
}
