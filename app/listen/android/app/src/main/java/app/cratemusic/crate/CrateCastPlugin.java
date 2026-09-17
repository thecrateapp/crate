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
import com.google.android.gms.cast.MediaQueueItem;
import com.google.android.gms.cast.MediaSeekOptions;
import com.google.android.gms.cast.MediaStatus;
import com.google.android.gms.cast.Cast;
import com.google.android.gms.cast.CastDevice;
import com.google.android.gms.cast.framework.CastButtonFactory;
import com.google.android.gms.cast.framework.CastContext;
import com.google.android.gms.cast.framework.CastSession;
import com.google.android.gms.cast.framework.CastState;
import com.google.android.gms.cast.framework.SessionManager;
import com.google.android.gms.cast.framework.SessionManagerListener;
import com.google.android.gms.cast.framework.media.RemoteMediaClient;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.common.api.PendingResult;
import com.google.android.gms.common.images.WebImage;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.List;

@CapacitorPlugin(
    name = "CrateCast",
    permissions = {
        @Permission(alias = "castLocation", strings = { Manifest.permission.ACCESS_FINE_LOCATION }),
        @Permission(alias = "castNearbyWifi", strings = { Manifest.permission.NEARBY_WIFI_DEVICES })
    }
)
public class CrateCastPlugin extends Plugin {
    private static final String TAG = "CrateCastPlugin";
    private static final String CAST_PROTOCOL_NAMESPACE =
        "urn:x-cast:app.cratemusic.crate.v1";
    private static final long CAST_REQUEST_TIMEOUT_MS = 60_000L;
    private static final String PERMISSION_CAST_LOCATION = "castLocation";
    private static final String PERMISSION_CAST_NEARBY_WIFI = "castNearbyWifi";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private PluginCall pendingRequestCall;
    private JSObject pendingMediaPayload;
    private Runnable pendingRequestTimeout;
    private MediaRouteButton routeButton;
    private CastSession observedSession;
    private RemoteMediaClient observedRemoteClient;

    private final RemoteMediaClient.Callback remoteMediaCallback =
        new RemoteMediaClient.Callback() {
            @Override
            public void onStatusUpdated() {
                publishPlaybackState();
            }

            @Override
            public void onMetadataUpdated() {
                publishPlaybackState();
            }

            @Override
            public void onQueueStatusUpdated() {
                publishPlaybackState();
            }
        };

    private final Cast.MessageReceivedCallback protocolMessageCallback =
        new Cast.MessageReceivedCallback() {
            @Override
            public void onMessageReceived(
                CastDevice castDevice,
                String namespace,
                String message
            ) {
                JSObject payload = new JSObject();
                payload.put("namespace", namespace);
                payload.put("message", message);
                notifyListeners("protocolMessage", payload, true);
            }
        };

    private final SessionManagerListener<CastSession> sessionListener =
        new SessionManagerListener<CastSession>() {
            @Override
            public void onSessionStarted(CastSession session, String sessionId) {
                bindSession(session);
                loadPendingMedia(session);
            }

            @Override
            public void onSessionResumed(CastSession session, boolean wasSuspended) {
                bindSession(session);
                loadPendingMedia(session);
                notifyListeners("sessionChanged", castStatePayload(true, session), true);
            }

            @Override
            public void onSessionEnded(CastSession session, int error) {
                rejectPending("Cast session ended before playback started.");
                unbindSession();
                notifyListeners("sessionChanged", castStatePayload(false, null), true);
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
            bindSession(currentSession(castContext()));
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
        unbindSession();
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
                boolean permissionRequired = !hasCastDiscoveryPermission();
                int state = context.getCastState();
                JSObject payload = new JSObject();
                payload.put("platform", "native");
                payload.put("visible", true);
                payload.put(
                    "available",
                    permissionRequired || active || state != CastState.NO_DEVICES_AVAILABLE
                );
                payload.put("activeSession", active);
                payload.put("targetName", active ? session.getCastDevice().getFriendlyName() : null);
                payload.put(
                    "receiverApplicationId",
                    getContext().getString(R.string.crate_cast_receiver_app_id)
                );
                if (active) {
                    bindSession(session);
                    putCrateSessionMetadata(payload, session);
                }
                if (permissionRequired) {
                    payload.put("reason", "Nearby-device permission is required for Cast discovery.");
                } else if (!active && state == CastState.NO_DEVICES_AVAILABLE) {
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

    @PluginMethod
    public void getQueueSnapshot(PluginCall call) {
        mainHandler.post(() -> {
            RemoteMediaClient remoteClient = activeRemoteClient();
            MediaStatus status = remoteClient == null ? null : remoteClient.getMediaStatus();
            if (status == null) {
                JSObject payload = queueSnapshotPayload(null);
                payload.put("available", false);
                call.resolve(payload);
                return;
            }
            JSObject payload = queueSnapshotPayload(status.getQueueItems());
            payload.put("available", true);
            call.resolve(payload);
        });
    }

    @PluginMethod
    public void queueInsert(PluginCall call) {
        try {
            MediaQueueItem[] items = buildQueueItems(call.getArray("items"));
            int insertBefore = call.getInt(
                "insertBefore",
                MediaQueueItem.INVALID_ITEM_ID
            );
            runWithRemoteClient(
                call,
                remoteClient -> remoteClient.queueInsertItems(
                    items,
                    insertBefore,
                    null
                )
            );
        } catch (JSONException error) {
            call.resolve(result(false, "Invalid Cast queue items."));
        }
    }

    @PluginMethod
    public void queueRemove(PluginCall call) {
        int[] itemIds = jsonIntArray(call.getArray("itemIds"));
        runWithRemoteClient(
            call,
            remoteClient -> remoteClient.queueRemoveItems(itemIds, null)
        );
    }

    @PluginMethod
    public void queueReorder(PluginCall call) {
        int[] itemIds = jsonIntArray(call.getArray("itemIds"));
        runWithRemoteClient(
            call,
            remoteClient -> remoteClient.queueReorderItems(
                itemIds,
                MediaQueueItem.INVALID_ITEM_ID,
                null
            )
        );
    }

    @PluginMethod
    public void queueSetRepeatMode(PluginCall call) {
        int repeatMode = repeatMode(call.getString("repeatMode", "off"));
        runWithRemoteClient(
            call,
            remoteClient -> remoteClient.queueSetRepeatMode(repeatMode, null)
        );
    }

    @PluginMethod
    public void queueNext(PluginCall call) {
        runWithRemoteClient(call, remoteClient -> remoteClient.queueNext(null));
    }

    @PluginMethod
    public void queuePrevious(PluginCall call) {
        runWithRemoteClient(call, remoteClient -> remoteClient.queuePrev(null));
    }

    @PluginMethod
    public void queueJumpTo(PluginCall call) {
        int index = Math.max(0, call.getInt("index", 0));
        mainHandler.post(() -> {
            RemoteMediaClient remoteClient = activeRemoteClient();
            MediaStatus status = remoteClient == null ? null : remoteClient.getMediaStatus();
            MediaQueueItem item = status == null ? null : status.getQueueItem(index);
            if (remoteClient == null || item == null) {
                call.resolve(result(false, "Cast queue item is unavailable."));
                return;
            }
            resolvePendingResult(
                call,
                remoteClient.queueJumpToItem(item.getItemId(), null)
            );
        });
    }

    @PluginMethod
    public void endSession(PluginCall call) {
        mainHandler.post(() -> {
            try {
                boolean stopCasting = call.getBoolean("stopCasting", true);
                castContext().getSessionManager().endCurrentSession(stopCasting);
                unbindSession();
                notifyListeners("sessionChanged", castStatePayload(false, null), true);
                call.resolve(result(true, null));
            } catch (RuntimeException error) {
                Log.w(TAG, "Could not end Cast session.", error);
                call.resolve(result(false, "Could not end Cast session."));
            }
        });
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

    private JSObject castStatePayload(boolean active, CastSession session) {
        JSObject payload = new JSObject();
        payload.put("active", active);
        if (active && session != null) {
            CastDevice device = session.getCastDevice();
            payload.put("targetName", device == null ? null : device.getFriendlyName());
            putCrateSessionMetadata(payload, session);
        }
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
            bindSession(session);
            RemoteMediaClient remoteClient = session.getRemoteMediaClient();
            if (remoteClient == null) {
                rejectPending("Cast receiver is not ready.");
                return;
            }
            PendingResult<RemoteMediaClient.MediaChannelResult> pendingResult;
            JSONArray queueItems = pendingMediaPayload.optJSONArray("items");
            if (queueItems != null) {
                MediaQueueItem[] items = buildQueueItems(queueItems);
                if (items.length == 0) {
                    rejectPending("Cast queue is empty.");
                    return;
                }
                int startIndex = Math.max(
                    0,
                    Math.min(
                        pendingMediaPayload.optInt("currentIndex", 0),
                        items.length - 1
                    )
                );
                long startTimeMs = Math.max(
                    0,
                    Math.round(pendingMediaPayload.optDouble("currentTime", 0.0) * 1000)
                );
                pendingResult = remoteClient.queueLoad(
                    items,
                    startIndex,
                    repeatMode(pendingMediaPayload.optString("repeatMode", "off")),
                    startTimeMs,
                    buildSessionCustomData(pendingMediaPayload)
                );
            } else {
                pendingResult = remoteClient.load(buildLoadRequest(pendingMediaPayload));
            }
            pendingResult.setResultCallback(mediaResult -> mainHandler.post(() -> {
                if (pendingRequestCall != call) return;
                if (mediaResult.getStatus().isSuccess()) {
                    JSObject response = result(true, "Casting started.");
                    CastDevice device = session.getCastDevice();
                    if (device != null) {
                        response.put("targetName", device.getFriendlyName());
                    }
                    call.resolve(response);
                    clearPending();
                    notifyListeners("sessionChanged", castStatePayload(true, session), true);
                    publishPlaybackState();
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
        double currentTime = payload.optDouble("currentTime", 0.0);

        return new MediaLoadRequestData.Builder()
            .setMediaInfo(buildMediaInfo(payload))
            .setAutoplay(true)
            .setCurrentTime(Math.max(0, Math.round(currentTime * 1000)))
            .build();
    }

    private MediaQueueItem[] buildQueueItems(JSONArray payload) throws JSONException {
        if (payload == null) return new MediaQueueItem[0];
        MediaQueueItem[] items = new MediaQueueItem[payload.length()];
        for (int index = 0; index < payload.length(); index += 1) {
            JSONObject itemPayload = payload.getJSONObject(index);
            JSONObject customData = itemPayload.optJSONObject("customData");
            MediaQueueItem.Builder builder = new MediaQueueItem.Builder(
                buildMediaInfo(itemPayload)
            ).setAutoplay(true);
            if (customData != null) builder.setCustomData(customData);
            items[index] = builder.build();
        }
        return items;
    }

    private MediaInfo buildMediaInfo(JSONObject payload) throws JSONException {
        String streamUrl = payload.optString("streamUrl", "");
        if (streamUrl.isEmpty()) throw new JSONException("Missing Cast stream URL.");
        String contentType = payload.optString("contentType", "audio/mpeg");
        String title = payload.optString("title", "Crate");
        String artist = payload.optString("artist", "");
        String album = payload.optString("album", "");
        String artworkUrl = payload.optString("artworkUrl", "");
        String metadataUrl = payload.optString("metadataUrl", "");
        double duration = payload.optDouble("duration", 0.0);

        MediaMetadata metadata = new MediaMetadata(MediaMetadata.MEDIA_TYPE_MUSIC_TRACK);
        metadata.putString(MediaMetadata.KEY_TITLE, title);
        metadata.putString(MediaMetadata.KEY_ARTIST, artist);
        metadata.putString(MediaMetadata.KEY_ALBUM_TITLE, album);
        if (!artworkUrl.isEmpty()) {
            metadata.addImage(new WebImage(Uri.parse(artworkUrl)));
        }

        JSONObject customData = payload.optJSONObject("customData");
        if (customData == null) customData = new JSONObject();
        if (!metadataUrl.isEmpty()) customData.put("metadataUrl", metadataUrl);

        MediaInfo.Builder mediaInfoBuilder = new MediaInfo.Builder(streamUrl)
            .setContentType(contentType)
            .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
            .setMetadata(metadata)
            .setCustomData(customData);
        if (duration > 0) {
            mediaInfoBuilder.setStreamDuration(Math.round(duration * 1000));
        }
        return mediaInfoBuilder.build();
    }

    private JSONObject buildSessionCustomData(JSONObject payload) throws JSONException {
        JSONObject crateCast = new JSONObject();
        crateCast.put("protocolVersion", payload.optInt("protocolVersion", 1));
        crateCast.put("sessionId", payload.optString("sessionId", ""));
        crateCast.put("bootstrapUrl", payload.optString("bootstrapUrl", ""));
        JSONObject customData = new JSONObject();
        customData.put("crateCast", crateCast);
        return customData;
    }

    private static int repeatMode(String value) {
        if ("all".equals(value)) return MediaStatus.REPEAT_MODE_REPEAT_ALL;
        if ("one".equals(value)) return MediaStatus.REPEAT_MODE_REPEAT_SINGLE;
        return MediaStatus.REPEAT_MODE_REPEAT_OFF;
    }

    private static int[] jsonIntArray(JSONArray values) {
        if (values == null) return new int[0];
        int[] result = new int[values.length()];
        for (int index = 0; index < values.length(); index += 1) {
            result[index] = values.optInt(index, MediaQueueItem.INVALID_ITEM_ID);
        }
        return result;
    }

    private JSObject queueSnapshotPayload(List<MediaQueueItem> queueItems) {
        JSONArray items = new JSONArray();
        if (queueItems != null) {
            for (MediaQueueItem item : queueItems) {
                String stableId = stableItemId(item);
                if (stableId == null) continue;
                JSONObject value = new JSONObject();
                try {
                    value.put("stableId", stableId);
                    value.put("itemId", item.getItemId());
                    items.put(value);
                } catch (JSONException error) {
                    Log.w(TAG, "Could not serialize Cast queue item.", error);
                }
            }
        }
        JSObject payload = new JSObject();
        payload.put("items", items);
        return payload;
    }

    private String stableItemId(MediaQueueItem item) {
        MediaInfo mediaInfo = item == null ? null : item.getMedia();
        JSONObject customData = mediaInfo == null ? null : mediaInfo.getCustomData();
        if (customData == null && item != null) customData = item.getCustomData();
        JSONObject crateCast = customData == null
            ? null
            : customData.optJSONObject("crateCast");
        String itemId = crateCast == null ? "" : crateCast.optString("itemId", "");
        return itemId.isEmpty() ? null : itemId;
    }

    private void bindSession(CastSession session) {
        if (session == observedSession) return;
        unbindSession();
        if (session == null) return;
        observedSession = session;
        observedRemoteClient = session.getRemoteMediaClient();
        if (observedRemoteClient != null) {
            observedRemoteClient.registerCallback(remoteMediaCallback);
        }
        try {
            session.setMessageReceivedCallbacks(
                CAST_PROTOCOL_NAMESPACE,
                protocolMessageCallback
            );
        } catch (IOException | IllegalStateException error) {
            Log.w(TAG, "Could not bind Cast protocol channel.", error);
        }
        publishPlaybackState();
    }

    private void unbindSession() {
        if (observedRemoteClient != null) {
            observedRemoteClient.unregisterCallback(remoteMediaCallback);
        }
        if (observedSession != null) {
            try {
                observedSession.removeMessageReceivedCallbacks(CAST_PROTOCOL_NAMESPACE);
            } catch (IOException | IllegalArgumentException error) {
                Log.w(TAG, "Could not unbind Cast protocol channel.", error);
            }
        }
        observedRemoteClient = null;
        observedSession = null;
    }

    private RemoteMediaClient activeRemoteClient() {
        CastSession session = currentSession(castContext());
        if (session == null || !session.isConnected()) return null;
        bindSession(session);
        return session.getRemoteMediaClient();
    }

    private void publishPlaybackState() {
        RemoteMediaClient remoteClient = observedRemoteClient;
        MediaStatus status = remoteClient == null ? null : remoteClient.getMediaStatus();
        JSObject payload = new JSObject();
        boolean active = observedSession != null && observedSession.isConnected();
        payload.put("active", active);
        payload.put(
            "currentTime",
            remoteClient == null
                ? 0.0
                : Math.max(0, remoteClient.getApproximateStreamPosition()) / 1000.0
        );
        payload.put(
            "duration",
            remoteClient == null
                ? 0.0
                : Math.max(0, remoteClient.getStreamDuration()) / 1000.0
        );
        payload.put("isBuffering", remoteClient != null && remoteClient.isBuffering());
        payload.put("isPlaying", remoteClient != null && remoteClient.isPlaying());
        if (status != null) {
            Integer index = status.getIndexById(status.getCurrentItemId());
            if (index != null && index >= 0) payload.put("currentIndex", index);
            payload.put("volume", Math.max(0.0, Math.min(1.0, status.getStreamVolume())));
        }
        notifyListeners("playbackState", payload, true);
    }

    private void putCrateSessionMetadata(JSObject payload, CastSession session) {
        RemoteMediaClient remoteClient = session == null
            ? null
            : session.getRemoteMediaClient();
        MediaInfo mediaInfo = remoteClient == null ? null : remoteClient.getMediaInfo();
        JSONObject customData = mediaInfo == null ? null : mediaInfo.getCustomData();
        JSONObject crateCast = customData == null
            ? null
            : customData.optJSONObject("crateCast");
        if (crateCast == null) return;
        String sessionId = crateCast.optString("sessionId", "");
        String bootstrapUrl = crateCast.optString("bootstrapUrl", "");
        if (!sessionId.isEmpty()) payload.put("sessionId", sessionId);
        if (!bootstrapUrl.isEmpty()) payload.put("bootstrapUrl", bootstrapUrl);
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
        PendingResult<RemoteMediaClient.MediaChannelResult> run(RemoteMediaClient remoteClient);
    }

    private void runWithRemoteClient(PluginCall call, RemoteClientAction action) {
        mainHandler.post(() -> {
            try {
                RemoteMediaClient remoteClient = activeRemoteClient();
                if (remoteClient == null) {
                    call.resolve(result(false, "No active Cast media session."));
                    return;
                }
                PendingResult<RemoteMediaClient.MediaChannelResult> pendingResult = action.run(remoteClient);
                resolvePendingResult(call, pendingResult);
            } catch (RuntimeException error) {
                Log.w(TAG, "Cast control failed.", error);
                call.resolve(result(false, "Cast control failed."));
            }
        });
    }

    private void resolvePendingResult(
        PluginCall call,
        PendingResult<RemoteMediaClient.MediaChannelResult> pendingResult
    ) {
        if (pendingResult == null) {
            call.resolve(result(true, null));
            return;
        }
        pendingResult.setResultCallback(mediaChannelResult -> {
            if (mediaChannelResult.getStatus().isSuccess()) {
                call.resolve(result(true, null));
                publishPlaybackState();
            } else {
                call.resolve(result(false, "Cast command was rejected by the receiver."));
            }
        });
    }
}
