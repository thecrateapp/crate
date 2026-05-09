package app.cratemusic.crate;

import android.app.PendingIntent;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioManager;
import android.content.Intent;
import android.media.audiofx.Equalizer;
import android.net.Uri;
import android.os.Build;
import android.os.Binder;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.analytics.AnalyticsListener;
import androidx.media3.session.CommandButton;
import androidx.media3.session.DefaultMediaNotificationProvider;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import org.json.JSONException;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

@UnstableApi
public class CrateNativePlaybackService extends MediaSessionService {
    private static final String TAG = "CrateNativePlayback";
    private static final String CHANNEL_ID = "crate_playback";
    private static final int NOTIFICATION_ID = 7301;

    public interface EventSink {
        void emit(String eventName, JSObject payload);
    }

    public static final class NativeTrack {
        public final String id;
        public final String url;
        public final String title;
        public final String artist;
        public final String album;
        public final String artwork;
        public final long durationMs;
        @Nullable
        public final float[] eqGains;

        public NativeTrack(
            String id,
            String url,
            String title,
            String artist,
            String album,
            String artwork,
            long durationMs,
            @Nullable float[] eqGains
        ) {
            this.id = valueOrDefault(id, UUID.randomUUID().toString());
            this.url = valueOrDefault(url, "");
            this.title = valueOrDefault(title, "Unknown");
            this.artist = valueOrDefault(artist, "");
            this.album = valueOrDefault(album, "");
            this.artwork = valueOrDefault(artwork, "");
            this.durationMs = Math.max(0L, durationMs);
            this.eqGains = eqGains;
        }
    }

    private static final int POSITION_UPDATE_MS = 500;
    private static final int PLAY_EVENT_CHECKPOINT_MS = 5000;
    private static final int MAX_BUFFERED_EVENTS = 200;

    private final IBinder binder = new LocalBinder();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable positionTicker = new Runnable() {
        @Override
        public void run() {
            emitPosition();
            emitPlayEventCheckpointIfNeeded();
            mainHandler.postDelayed(this, POSITION_UPDATE_MS);
        }
    };
    private final List<JSObject> bufferedEvents = new ArrayList<>();
    private final List<NativeTrack> queue = new ArrayList<>();

    private ExoPlayer player;
    private MediaSession mediaSession;
    private Equalizer systemEqualizer;
    private EventSink eventSink;
    private String queueRevision = "";
    private int crossfadeMs = 0;
    private boolean positionTickerStarted = false;
    private int lastPlayEventCheckpointIndex = -1;
    private long lastPlayEventCheckpointPositionMs = 0L;
    private float[] currentEqGains = new float[10];
    private boolean eqEnabled = false;
    private boolean sessionRegistered = false;
    private int systemEqAudioSessionId = C.AUDIO_SESSION_ID_UNSET;

    public final class LocalBinder extends Binder {
        CrateNativePlaybackService getService() {
            return CrateNativePlaybackService.this;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        stopLegacyPlaybackService();
        createNotificationChannel();
        DefaultMediaNotificationProvider notificationProvider =
            new DefaultMediaNotificationProvider.Builder(this)
                .setChannelId(CHANNEL_ID)
                .setChannelName(R.string.crate_playback_channel_name)
                .setNotificationId(NOTIFICATION_ID)
                .build();
        notificationProvider.setSmallIcon(R.drawable.ic_stat_crate);
        setMediaNotificationProvider(notificationProvider);
        player = buildPlayer();
        assignStableAudioSessionId();
        player.setWakeMode(C.WAKE_MODE_LOCAL);
        player.setAudioAttributes(
            new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build(),
            true
        );
        player.setHandleAudioBecomingNoisy(true);
        player.addAnalyticsListener(new AnalyticsListener() {
            @Override
            public void onAudioSessionIdChanged(EventTime eventTime, int audioSessionId) {
                applyEqForCurrentTrack();
            }
        });
        player.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                emitState("stateChanged");
                requestNotificationUpdate();
            }

            @Override
            public void onPlaybackStateChanged(int playbackState) {
                emitState("stateChanged");
                requestNotificationUpdate();
                if (playbackState == Player.STATE_READY) {
                    applyEqForCurrentTrack();
                }
                if (
                    playbackState == Player.STATE_BUFFERING ||
                    playbackState == Player.STATE_READY ||
                    playbackState == Player.STATE_ENDED ||
                    playbackState == Player.STATE_IDLE
                ) {
                    JSObject payload = basePayload();
                    payload.put("isBuffering", playbackState == Player.STATE_BUFFERING);
                    emit("bufferingChanged", payload);
                }
                if (playbackState == Player.STATE_ENDED) {
                    emit("queueEnded", basePayload());
                }
            }

            @Override
            public void onMediaItemTransition(@Nullable MediaItem mediaItem, int reason) {
                resetPlayEventCheckpoint();
                applyEqForCurrentTrack();
                requestNotificationUpdate();
                JSObject payload = basePayload();
                payload.put("index", player.getCurrentMediaItemIndex());
                payload.put("reason", transitionReason(reason));
                payload.put("trackId", mediaItem == null ? "" : mediaItem.mediaId);
                payload.put("positionMs", Math.max(0L, player.getCurrentPosition()));
                payload.put("durationMs", safeDuration(player.getDuration()));
                payload.put("isPlaying", player.isPlaying());
                emit("trackChanged", payload);
                emitNearQueueEndIfNeeded();
            }

            @Override
            public void onPositionDiscontinuity(
                Player.PositionInfo oldPosition,
                Player.PositionInfo newPosition,
                int reason
            ) {
                resetPlayEventCheckpoint();
                emitState("stateChanged");
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                JSObject payload = basePayload();
                NativeTrack currentTrack = getCurrentNativeTrack();
                Throwable rootCause = rootCause(error);
                Integer httpStatus = httpStatus(error);
                payload.put("code", error.errorCode);
                payload.put("message", error.getMessage());
                payload.put("trackId", currentTrack == null ? "" : currentTrack.id);
                payload.put("url", currentTrack == null ? "" : redactUrl(currentTrack.url));
                payload.put("cause", rootCause == null ? "" : rootCause.getClass().getName());
                payload.put("causeMessage", rootCause == null ? "" : valueOrDefault(rootCause.getMessage(), ""));
                if (httpStatus != null) {
                    payload.put("httpStatus", httpStatus);
                }
                Log.e(
                    TAG,
                    "Playback error"
                        + " code=" + error.errorCode
                        + " httpStatus=" + (httpStatus == null ? "n/a" : httpStatus)
                        + " track=" + (currentTrack == null ? "" : currentTrack.id)
                        + " url=" + (currentTrack == null ? "" : redactUrl(currentTrack.url)),
                    error
                );
                emit("error", payload);
            }
        });
        MediaSession.Builder sessionBuilder = new MediaSession.Builder(this, player)
            .setId("crate-native-playback")
            .setMediaButtonPreferences(mediaButtonPreferences())
            .setShowPlayButtonIfPlaybackIsSuppressed(true)
            .setCallback(new MediaSession.Callback() {
                @Override
                public MediaSession.ConnectionResult onConnect(
                    MediaSession session,
                    MediaSession.ControllerInfo controller
                ) {
                    return MediaSession.ConnectionResult.accept(
                        MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS,
                        new Player.Commands.Builder()
                            .addAll(MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS)
                            .add(Player.COMMAND_PLAY_PAUSE)
                            .add(Player.COMMAND_PREPARE)
                            .add(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)
                            .add(Player.COMMAND_SEEK_TO_PREVIOUS)
                            .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                            .add(Player.COMMAND_SEEK_TO_NEXT)
                            .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                            .add(Player.COMMAND_GET_CURRENT_MEDIA_ITEM)
                            .add(Player.COMMAND_GET_TIMELINE)
                            .add(Player.COMMAND_GET_METADATA)
                            .build()
                    );
                }
            });
        PendingIntent sessionActivity = buildSessionActivity();
        if (sessionActivity != null) {
            sessionBuilder.setSessionActivity(sessionActivity);
        }
        mediaSession = sessionBuilder.build();
        addSession(mediaSession);
        sessionRegistered = true;
        startPositionTicker();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            getString(R.string.crate_playback_channel_name),
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Crate playback controls");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.setShowBadge(false);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }

    private void stopLegacyPlaybackService() {
        try {
            stopService(new Intent(this, CratePlaybackService.class));
        } catch (RuntimeException ignored) {
            // The legacy service is only a fallback; never block native playback startup.
        }
    }

    private void requestNotificationUpdate() {
        if (mediaSession == null || player == null) return;
        onUpdateNotification(mediaSession, player.isPlaying());
    }

    private ExoPlayer buildPlayer() {
        DefaultRenderersFactory renderersFactory = new DefaultRenderersFactory(this)
            .setEnableDecoderFallback(true)
            .setEnableAudioTrackPlaybackParams(true);
        return new ExoPlayer.Builder(this, renderersFactory).build();
    }

    private void assignStableAudioSessionId() {
        if (player == null) return;
        try {
            AudioManager audioManager = getSystemService(AudioManager.class);
            if (audioManager == null) return;
            int audioSessionId = audioManager.generateAudioSessionId();
            if (audioSessionId > 0 && audioSessionId != C.AUDIO_SESSION_ID_UNSET) {
                player.setAudioSessionId(audioSessionId);
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Could not assign stable audio session id; using player-managed session", error);
        }
    }

    private List<CommandButton> mediaButtonPreferences() {
        return Arrays.asList(
            new CommandButton.Builder(CommandButton.ICON_PREVIOUS)
                .setPlayerCommand(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                .setDisplayName("Previous")
                .setSlots(CommandButton.SLOT_BACK)
                .build(),
            new CommandButton.Builder(CommandButton.ICON_PLAY)
                .setPlayerCommand(Player.COMMAND_PLAY_PAUSE)
                .setDisplayName("Play / pause")
                .setSlots(CommandButton.SLOT_CENTRAL)
                .build(),
            new CommandButton.Builder(CommandButton.ICON_NEXT)
                .setPlayerCommand(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                .setDisplayName("Next")
                .setSlots(CommandButton.SLOT_FORWARD)
                .build()
        );
    }

    private void refreshMediaSessionControls() {
        if (mediaSession == null) return;
        mediaSession.setMediaButtonPreferences(mediaButtonPreferences());
    }

    @Nullable
    private PendingIntent buildSessionActivity() {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launchIntent == null) return null;
        launchIntent.setPackage(getPackageName());
        return PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    @Override
    public IBinder onBind(Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (
            MediaSessionService.SERVICE_INTERFACE.equals(action) ||
            "android.media.browse.MediaBrowserService".equals(action)
        ) {
            return super.onBind(intent);
        }
        return binder;
    }

    @Override
    @Nullable
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (player == null) {
            stopSelf();
            return;
        }
        if (!player.getPlayWhenReady() || player.getMediaItemCount() == 0 || player.getPlaybackState() == Player.STATE_ENDED) {
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        stopPositionTicker();
        if (mediaSession != null) {
            if (sessionRegistered) {
                removeSession(mediaSession);
                sessionRegistered = false;
            }
            mediaSession.release();
            mediaSession = null;
        }
        if (player != null) {
            player.release();
            player = null;
        }
        releaseSystemEqualizer();
        super.onDestroy();
    }

    public void setEventSink(@Nullable EventSink sink) {
        eventSink = sink;
    }

    public JSArray drainEvents() {
        JSArray events = new JSArray();
        for (JSObject event : bufferedEvents) {
            events.put(event);
        }
        bufferedEvents.clear();
        return events;
    }

    public JSObject getSnapshot() {
        JSObject payload = basePayload();
        payload.put("isPlaying", player != null && player.isPlaying());
        payload.put(
            "playbackState",
            playbackStateName(
                player == null ? Player.STATE_IDLE : player.getPlaybackState(),
                player != null && player.isPlaying()
            )
        );
        payload.put("index", player == null ? -1 : player.getCurrentMediaItemIndex());
        payload.put("positionMs", player == null ? 0L : Math.max(0L, player.getCurrentPosition()));
        payload.put("durationMs", player == null ? 0L : safeDuration(player.getDuration()));
        payload.put("queueSize", queue.size());
        payload.put("crossfadeMs", crossfadeMs);
        payload.put("eqEnabled", eqEnabled);
        return payload;
    }

    public void setQueue(
        String revision,
        List<NativeTrack> tracks,
        int startIndex,
        long positionMs,
        boolean autoplay,
        String repeat,
        int crossfadeMs,
        float volume
    ) {
        if (player == null) return;
        queueRevision = valueOrDefault(revision, UUID.randomUUID().toString());
        queue.clear();
        this.crossfadeMs = Math.max(0, crossfadeMs);
        resetPlayEventCheckpoint();

        List<MediaItem> mediaItems = new ArrayList<>();
        int filteredStartIndex = 0;
        List<NativeTrack> inputTracks = tracks == null ? Collections.emptyList() : tracks;
        for (int index = 0; index < inputTracks.size(); index++) {
            NativeTrack track = inputTracks.get(index);
            if (track.url.isEmpty()) continue;
            if (index < startIndex) {
                filteredStartIndex++;
            }
            queue.add(track);
            mediaItems.add(toMediaItem(track));
        }

        int safeIndex = mediaItems.isEmpty()
            ? 0
            : Math.max(0, Math.min(filteredStartIndex, mediaItems.size() - 1));
        player.setMediaItems(mediaItems, safeIndex, Math.max(0L, positionMs));
        player.setRepeatMode(toRepeatMode(repeat));
        player.setVolume(clampVolume(volume));
        Log.i(
            TAG,
            "Loading native queue"
                + " revision=" + queueRevision
                + " size=" + mediaItems.size()
                + " index=" + safeIndex
                + " autoplay=" + autoplay
                + " firstUrl=" + (queue.isEmpty() ? "" : redactUrl(queue.get(safeIndex).url))
        );
        player.prepare();
        applyEqForCurrentTrack();
        refreshMediaSessionControls();
        emitState("stateChanged");
        if (autoplay && !mediaItems.isEmpty()) {
            player.play();
        }
    }

    public void appendTracks(String revision, List<NativeTrack> tracks) {
        if (!isCurrentRevision(revision)) return;
        if (player == null || tracks == null || tracks.isEmpty()) return;
        for (NativeTrack track : tracks) {
            if (track.url.isEmpty()) continue;
            queue.add(track);
            player.addMediaItem(toMediaItem(track));
        }
        refreshMediaSessionControls();
        emitState("stateChanged");
    }

    public void insertTrack(String revision, int index, NativeTrack track) {
        if (!isCurrentRevision(revision)) return;
        if (player == null || track == null || track.url.isEmpty()) return;
        int safeIndex = Math.max(0, Math.min(index, queue.size()));
        queue.add(safeIndex, track);
        player.addMediaItem(safeIndex, toMediaItem(track));
        refreshMediaSessionControls();
        emitState("stateChanged");
    }

    public void removeTrack(String revision, int index) {
        if (!isCurrentRevision(revision)) return;
        if (player == null || index < 0 || index >= queue.size()) return;
        queue.remove(index);
        player.removeMediaItem(index);
        refreshMediaSessionControls();
        emitState("stateChanged");
    }

    public void reorderTrack(String revision, int fromIndex, int toIndex) {
        if (!isCurrentRevision(revision)) return;
        if (player == null) return;
        if (fromIndex < 0 || fromIndex >= queue.size() || toIndex < 0 || toIndex >= queue.size()) return;
        NativeTrack moved = queue.remove(fromIndex);
        queue.add(toIndex, moved);
        player.moveMediaItem(fromIndex, toIndex);
        refreshMediaSessionControls();
        emitState("stateChanged");
    }

    public void play() {
        if (player != null) player.play();
    }

    public void pause() {
        if (player != null) player.pause();
    }

    public void stopPlayback() {
        if (player != null) player.stop();
    }

    public void seekTo(long positionMs) {
        if (player != null) player.seekTo(Math.max(0L, positionMs));
    }

    public void jumpTo(int index, boolean autoplay) {
        if (player == null || index < 0 || index >= player.getMediaItemCount()) return;
        player.seekToDefaultPosition(index);
        if (autoplay) player.play();
    }

    public void next() {
        if (player != null && player.hasNextMediaItem()) player.seekToNextMediaItem();
    }

    public void previous() {
        if (player != null && player.hasPreviousMediaItem()) player.seekToPreviousMediaItem();
    }

    public void setRepeat(String repeat) {
        if (player != null) player.setRepeatMode(toRepeatMode(repeat));
    }

    public void setCrossfadeMs(int crossfadeMs) {
        this.crossfadeMs = Math.max(0, crossfadeMs);
        JSObject payload = basePayload();
        payload.put("crossfadeMs", this.crossfadeMs);
        emit("crossfadeChanged", payload);
    }

    public void setAppVolume(float volume) {
        if (player != null) player.setVolume(clampVolume(volume));
    }

    public void setPlaybackRate(float rate) {
        if (player != null) player.setPlaybackSpeed(clampPlaybackRate(rate));
    }

    public void setEq(boolean enabled, float[] gains) {
        eqEnabled = enabled;
        currentEqGains = gains == null ? new float[10] : gains;
        applyEqForCurrentTrack();
    }

    private void startPositionTicker() {
        if (positionTickerStarted) return;
        positionTickerStarted = true;
        mainHandler.postDelayed(positionTicker, POSITION_UPDATE_MS);
    }

    private void stopPositionTicker() {
        if (!positionTickerStarted) return;
        positionTickerStarted = false;
        mainHandler.removeCallbacks(positionTicker);
    }

    private void emitPosition() {
        if (player == null || player.getMediaItemCount() == 0) return;
        JSObject payload = basePayload();
        payload.put("index", player.getCurrentMediaItemIndex());
        MediaItem mediaItem = player.getCurrentMediaItem();
        payload.put("trackId", mediaItem == null ? "" : mediaItem.mediaId);
        payload.put("positionMs", Math.max(0L, player.getCurrentPosition()));
        payload.put("durationMs", safeDuration(player.getDuration()));
        payload.put("isPlaying", player.isPlaying());
        emit("positionChanged", payload);
    }

    private void emitPlayEventCheckpointIfNeeded() {
        if (player == null || player.getMediaItemCount() == 0 || !player.isPlaying()) return;
        int index = player.getCurrentMediaItemIndex();
        if (index < 0) return;

        long positionMs = Math.max(0L, player.getCurrentPosition());
        boolean trackChanged = index != lastPlayEventCheckpointIndex;
        boolean movedBackwards = positionMs < lastPlayEventCheckpointPositionMs;
        boolean intervalElapsed = positionMs - lastPlayEventCheckpointPositionMs >= PLAY_EVENT_CHECKPOINT_MS;
        if (!trackChanged && !movedBackwards && !intervalElapsed) return;

        lastPlayEventCheckpointIndex = index;
        lastPlayEventCheckpointPositionMs = positionMs;

        JSObject payload = basePayload();
        MediaItem mediaItem = player.getCurrentMediaItem();
        payload.put("index", index);
        payload.put("trackId", mediaItem == null ? "" : mediaItem.mediaId);
        payload.put("positionMs", positionMs);
        payload.put("durationMs", safeDuration(player.getDuration()));
        payload.put("isPlaying", true);
        payload.put("checkpointMs", PLAY_EVENT_CHECKPOINT_MS);
        emit("playEventCheckpoint", payload);
    }

    private void resetPlayEventCheckpoint() {
        lastPlayEventCheckpointIndex = -1;
        lastPlayEventCheckpointPositionMs = 0L;
    }

    private void emitState(String eventName) {
        if (player == null) return;
        JSObject payload = getSnapshot();
        emit(eventName, payload);
    }

    private void emitNearQueueEndIfNeeded() {
        if (player == null || queue.size() < 4) return;
        int remaining = queue.size() - player.getCurrentMediaItemIndex() - 1;
        if (remaining <= 3) {
            JSObject payload = basePayload();
            payload.put("remainingTracks", remaining);
            emit("nearQueueEnd", payload);
        }
    }

    private void emit(String eventName, JSObject payload) {
        JSObject event = new JSObject();
        event.put("event", eventName);
        event.put("payload", payload);
        if (eventSink != null) {
            eventSink.emit(eventName, payload);
            return;
        }
        if ("positionChanged".equals(eventName)) {
            bufferLatestPositionEvent(event);
            return;
        }
        bufferEvent(event);
    }

    private void bufferLatestPositionEvent(JSObject event) {
        for (int index = bufferedEvents.size() - 1; index >= 0; index--) {
            JSObject bufferedEvent = bufferedEvents.get(index);
            if ("positionChanged".equals(bufferedEvent.optString("event", ""))) {
                bufferedEvents.set(index, event);
                return;
            }
        }
        bufferEvent(event);
    }

    private void bufferEvent(JSObject event) {
        bufferedEvents.add(event);
        while (bufferedEvents.size() > MAX_BUFFERED_EVENTS) {
            bufferedEvents.remove(0);
        }
    }

    private boolean isCurrentRevision(String revision) {
        return revision == null || revision.isEmpty() || queueRevision.equals(revision);
    }

    private JSObject basePayload() {
        JSObject payload = new JSObject();
        payload.put("revision", queueRevision);
        payload.put("nativeTimeMs", System.currentTimeMillis());
        return payload;
    }

    private MediaItem toMediaItem(NativeTrack track) {
        androidx.media3.common.MediaMetadata.Builder metadata =
            new androidx.media3.common.MediaMetadata.Builder()
                .setTitle(track.title)
                .setArtist(track.artist)
                .setAlbumTitle(track.album);
        if (track.durationMs > 0) {
            metadata.setDurationMs(track.durationMs);
        }
        if (!track.artwork.isEmpty()) {
            metadata.setArtworkUri(Uri.parse(track.artwork));
        }
        return new MediaItem.Builder()
            .setMediaId(track.id)
            .setUri(Uri.parse(track.url))
            .setMediaMetadata(metadata.build())
            .build();
    }

    private void applyEqForCurrentTrack() {
        if (player == null || player.getCurrentMediaItemIndex() < 0) return;
        NativeTrack track = getCurrentNativeTrack();
        boolean hasTrackSpecificGains = track != null && track.eqGains != null;
        float[] gains = hasTrackSpecificGains ? track.eqGains : currentEqGains;
        boolean applied = false;
        if (eqEnabled && !isFlatGains(gains)) {
            applied = applySystemEqualizer(gains);
        } else {
            releaseSystemEqualizer();
        }
        JSObject payload = basePayload();
        payload.put("enabled", eqEnabled);
        payload.put("applied", applied);
        payload.put("trackId", track == null ? "" : track.id);
        payload.put("source", hasTrackSpecificGains ? "track" : "global");
        payload.put("audioSessionId", player == null ? C.AUDIO_SESSION_ID_UNSET : player.getAudioSessionId());
        payload.put("gains", gainsToArray(gains));
        emit("eqChanged", payload);
    }

    @SuppressWarnings("deprecation")
    private boolean applySystemEqualizer(float[] gains) {
        if (player == null) return false;
        int audioSessionId = player.getAudioSessionId();
        if (audioSessionId == C.AUDIO_SESSION_ID_UNSET || audioSessionId <= 0) return false;

        try {
            if (systemEqualizer == null || systemEqAudioSessionId != audioSessionId) {
                releaseSystemEqualizer();
                systemEqualizer = new Equalizer(0, audioSessionId);
                systemEqAudioSessionId = audioSessionId;
            }
            short[] range = systemEqualizer.getBandLevelRange();
            short minLevel = range != null && range.length > 0 ? range[0] : -1500;
            short maxLevel = range != null && range.length > 1 ? range[1] : 1500;
            short bandCount = systemEqualizer.getNumberOfBands();
            for (short band = 0; band < bandCount; band++) {
                int centerHz = Math.max(1, systemEqualizer.getCenterFreq(band) / 1000);
                int crateBand = nearestCrateBand(centerHz);
                float gainDb = gains != null && crateBand < gains.length ? gains[crateBand] : 0f;
                short level = clampMillibels(Math.round(gainDb * 100f), minLevel, maxLevel);
                systemEqualizer.setBandLevel(band, level);
            }
            systemEqualizer.setEnabled(true);
            return true;
        } catch (RuntimeException error) {
            Log.w(TAG, "System equalizer failed; continuing without native EQ", error);
            releaseSystemEqualizer();
            return false;
        }
    }

    @SuppressWarnings("deprecation")
    private void releaseSystemEqualizer() {
        if (systemEqualizer == null) return;
        try {
            systemEqualizer.setEnabled(false);
            systemEqualizer.release();
        } catch (RuntimeException ignored) {
            // Some vendors throw if the audio session disappeared first.
        } finally {
            systemEqualizer = null;
            systemEqAudioSessionId = C.AUDIO_SESSION_ID_UNSET;
        }
    }

    private int nearestCrateBand(int frequencyHz) {
        final int[] crateBands = new int[] { 32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 };
        int bestIndex = 0;
        double bestDistance = Double.MAX_VALUE;
        double target = Math.log(Math.max(1, frequencyHz));
        for (int index = 0; index < crateBands.length; index++) {
            double distance = Math.abs(Math.log(crateBands[index]) - target);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = index;
            }
        }
        return bestIndex;
    }

    private short clampMillibels(int value, short minLevel, short maxLevel) {
        return (short) Math.max(minLevel, Math.min(maxLevel, value));
    }

    private JSArray gainsToArray(float[] gains) {
        JSArray array = new JSArray();
        if (gains == null) return array;
        for (float gain : gains) {
            try {
                array.put(gain);
            } catch (JSONException ignored) {
                // JSArray should accept primitive floats; keep telemetry best-effort.
            }
        }
        return array;
    }

    private static int toRepeatMode(String repeat) {
        if ("one".equals(repeat)) return Player.REPEAT_MODE_ONE;
        if ("all".equals(repeat)) return Player.REPEAT_MODE_ALL;
        return Player.REPEAT_MODE_OFF;
    }

    private static String playbackStateName(int playbackState, boolean isPlaying) {
        switch (playbackState) {
            case Player.STATE_BUFFERING:
                return "buffering";
            case Player.STATE_READY:
                return isPlaying ? "playing" : "paused";
            case Player.STATE_ENDED:
                return "ended";
            case Player.STATE_IDLE:
            default:
                return "idle";
        }
    }

    private static String transitionReason(int reason) {
        switch (reason) {
            case Player.MEDIA_ITEM_TRANSITION_REASON_AUTO:
                return "auto";
            case Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED:
                return "playlist";
            case Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT:
                return "repeat";
            case Player.MEDIA_ITEM_TRANSITION_REASON_SEEK:
                return "seek";
            default:
                return "unknown";
        }
    }

    private static long safeDuration(long durationMs) {
        return durationMs == C.TIME_UNSET ? 0L : Math.max(0L, durationMs);
    }

    private static float clampVolume(float volume) {
        if (Float.isNaN(volume) || Float.isInfinite(volume)) return 1.0f;
        return Math.max(0.0f, Math.min(1.0f, volume));
    }

    private static float clampPlaybackRate(float rate) {
        if (Float.isNaN(rate) || Float.isInfinite(rate)) return 1.0f;
        return Math.max(0.25f, Math.min(4.0f, rate));
    }

    private static boolean isFlatGains(float[] gains) {
        if (gains == null) return true;
        for (float gain : gains) {
            if (Math.abs(gain) > 0.01f) return false;
        }
        return true;
    }

    @Nullable
    private NativeTrack getCurrentNativeTrack() {
        if (player == null) return null;
        int index = player.getCurrentMediaItemIndex();
        return index >= 0 && index < queue.size() ? queue.get(index) : null;
    }

    @Nullable
    private static Throwable rootCause(Throwable throwable) {
        Throwable current = throwable;
        while (current != null && current.getCause() != null && current.getCause() != current) {
            current = current.getCause();
        }
        return current;
    }

    @Nullable
    private static Integer httpStatus(Throwable throwable) {
        Throwable current = throwable;
        while (current != null) {
            if (current instanceof HttpDataSource.InvalidResponseCodeException) {
                return ((HttpDataSource.InvalidResponseCodeException) current).responseCode;
            }
            current = current.getCause();
        }
        return null;
    }

    private static String redactUrl(String url) {
        if (url == null || url.isEmpty()) return "";
        return url.replaceAll("([?&]token=)[^&]+", "$1<redacted>");
    }

    private static String valueOrDefault(String value, String fallback) {
        return value == null || value.isEmpty() ? fallback : value;
    }
}
