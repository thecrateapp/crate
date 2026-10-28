package app.cratemusic.crate;

import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@OptIn(markerClass = UnstableApi.class)
final class ExoPlayerNativePlaybackDeck implements NativePlaybackDeck {
    private static final long READY_POSITION_TOLERANCE_MS = 250L;

    private final ExoPlayer player;
    private final NativeMixAudioProcessor audioProcessor;
    @Nullable
    private final PcmBusMixer busMixer;
    @Nullable
    private final PcmBusChannel busChannel;
    private final List<NativeTrack> queue = new ArrayList<>();

    ExoPlayerNativePlaybackDeck(
        ExoPlayer player,
        NativeMixAudioProcessor audioProcessor,
        @Nullable PcmBusMixer busMixer,
        int busChannelIndex
    ) {
        if (player == null) {
            throw new IllegalArgumentException("ExoPlayer is required");
        }
        if (audioProcessor == null) {
            throw new IllegalArgumentException(
                "Native mix audio processor is required"
            );
        }
        this.player = player;
        this.audioProcessor = audioProcessor;
        this.busMixer = busMixer;
        this.busChannel = busMixer == null ? null : busMixer.channel(busChannelIndex);
    }

    void replaceQueue(
        List<NativeTrack> tracks,
        List<MediaItem> mediaItems,
        int requestedIndex,
        long startPositionMs
    ) {
        queue.clear();
        if (tracks != null) {
            queue.addAll(tracks);
        }
        List<MediaItem> safeItems = mediaItems == null
            ? Collections.emptyList()
            : mediaItems;
        if (safeItems.isEmpty()) {
            player.clearMediaItems();
            return;
        }
        int safeIndex = Math.max(
            0,
            Math.min(requestedIndex, safeItems.size() - 1)
        );
        player.setMediaItems(
            safeItems,
            safeIndex,
            Math.max(0L, startPositionMs)
        );
    }

    void append(List<NativeTrack> tracks, List<MediaItem> mediaItems) {
        if (tracks != null) {
            queue.addAll(tracks);
        }
        if (mediaItems != null && !mediaItems.isEmpty()) {
            player.addMediaItems(mediaItems);
        }
    }

    void insert(int index, NativeTrack track, MediaItem mediaItem) {
        int safeIndex = Math.max(0, Math.min(index, queue.size()));
        queue.add(safeIndex, track);
        player.addMediaItem(safeIndex, mediaItem);
    }

    void remove(int index) {
        if (index < 0 || index >= queue.size()) {
            return;
        }
        queue.remove(index);
        player.removeMediaItem(index);
    }

    void move(int fromIndex, int toIndex) {
        if (
            fromIndex < 0 ||
            fromIndex >= queue.size() ||
            toIndex < 0 ||
            toIndex >= queue.size()
        ) {
            return;
        }
        NativeTrack track = queue.remove(fromIndex);
        queue.add(toIndex, track);
        player.moveMediaItem(fromIndex, toIndex);
    }

    @Override
    public void prepare(NativeTrack track, long startPositionMs) {
        int index = indexOf(track);
        if (index < 0) {
            throw new IllegalArgumentException(
                "Track is not part of the deck queue"
            );
        }
        releaseHold();
        player.seekTo(index, Math.max(0L, startPositionMs));
        player.prepare();
    }

    @Override
    public boolean isReadyFor(NativeTrack track) {
        MediaItem currentItem = player.getCurrentMediaItem();
        return (
            currentItem != null &&
            currentItem.mediaId.equals(track.id) &&
            player.getPlaybackState() == Player.STATE_READY
        );
    }

    @Override
    public boolean isReadyAt(
        NativeTrack track,
        long positionMs,
        long minimumBufferedMs
    ) {
        if (!isReadyFor(track)) {
            return false;
        }
        long currentPositionMs = Math.max(0L, player.getCurrentPosition());
        if (Math.abs(currentPositionMs - positionMs) > READY_POSITION_TOLERANCE_MS) {
            return false;
        }
        long durationMs = player.getDuration();
        long remainingMs = durationMs == C.TIME_UNSET
            ? minimumBufferedMs
            : Math.max(0L, durationMs - currentPositionMs);
        long bufferedAheadMs = Math.max(
            0L,
            player.getBufferedPosition() - currentPositionMs
        );
        return bufferedAheadMs >= Math.min(minimumBufferedMs, remainingMs);
    }

    @Override
    public void play() {
        player.play();
    }

    @Override
    public void pause() {
        player.pause();
    }

    @Override
    public void stop() {
        player.stop();
    }

    @Override
    public void seekTo(long positionMs) {
        player.seekTo(Math.max(0L, positionMs));
    }

    @Override
    public void setSpeed(float speed) {
        player.setPlaybackParameters(new PlaybackParameters(speed));
    }

    @Override
    public long positionMs() {
        return Math.max(0L, player.getCurrentPosition());
    }

    @Override
    public boolean holdStart() {
        if (busChannel == null) return false;
        busChannel.hold();
        return true;
    }

    @Override
    public long busFrame() {
        return busMixer == null ? 0L : busMixer.busFrame();
    }

    @Override
    public long starvations() {
        return busChannel == null ? 0L : busChannel.starvations();
    }

    @Override
    public void startAtBusFrame(long busFrame) {
        if (busChannel != null) busChannel.startAt(busFrame);
    }

    @Override
    public void releaseHold() {
        if (busChannel != null) busChannel.releaseHold();
    }

    @Override
    public void setVolume(float volume) {
        audioProcessor.setTargetGain(volume);
    }

    @Override
    public void startEnvelope(
        NativeMixAudioProcessor.Role role,
        long durationMs,
        float stagingGainDb,
        float bassHandoffAt,
        boolean djBlend
    ) {
        audioProcessor.startEnvelope(role, durationMs, stagingGainDb, bassHandoffAt, djBlend);
    }

    @Override
    public void clearEnvelope() {
        audioProcessor.clearEnvelope();
    }

    @Override
    public float envelopeProgress() {
        return audioProcessor.envelopeProgress();
    }

    @Override
    public void releasePreparedSource() {
        releaseHold();
        player.pause();
        player.stop();
        audioProcessor.clearEnvelope();
        audioProcessor.setGainImmediately(0.0f);
    }

    void setPauseAtEndOfTrack(boolean pauseAtEnd) {
        player.setPauseAtEndOfMediaItems(pauseAtEnd);
    }

    ExoPlayer player() {
        return player;
    }

    private int indexOf(NativeTrack track) {
        if (track == null) {
            return -1;
        }
        for (int index = 0; index < queue.size(); index++) {
            if (queue.get(index).id.equals(track.id)) {
                return index;
            }
        }
        return -1;
    }
}
