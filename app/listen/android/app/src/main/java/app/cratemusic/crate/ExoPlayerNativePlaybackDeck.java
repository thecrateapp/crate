package app.cratemusic.crate;

import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class ExoPlayerNativePlaybackDeck implements NativePlaybackDeck {
    private final ExoPlayer player;
    private final NativeMixAudioProcessor audioProcessor;
    private final List<NativeTrack> queue = new ArrayList<>();

    ExoPlayerNativePlaybackDeck(
        ExoPlayer player,
        NativeMixAudioProcessor audioProcessor
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
    public void setVolume(float volume) {
        audioProcessor.setTargetGain(volume);
    }

    @Override
    public void releasePreparedSource() {
        player.pause();
        player.stop();
        audioProcessor.setGainImmediately(0.0f);
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
