package app.cratemusic.crate;

import androidx.annotation.Nullable;

import java.util.UUID;

final class NativeTrack {
    final String id;
    final String url;
    final String authorization;
    final String title;
    final String artist;
    final String album;
    final String artwork;
    final long durationMs;
    @Nullable
    final float[] eqGains;

    NativeTrack(
        String id,
        String url,
        String authorization,
        String title,
        String artist,
        String album,
        String artwork,
        long durationMs,
        @Nullable float[] eqGains
    ) {
        this.id = valueOrDefault(id, UUID.randomUUID().toString());
        this.url = valueOrDefault(url, "");
        this.authorization = valueOrDefault(authorization, "");
        this.title = valueOrDefault(title, "Unknown");
        this.artist = valueOrDefault(artist, "");
        this.album = valueOrDefault(album, "");
        this.artwork = valueOrDefault(artwork, "");
        this.durationMs = Math.max(0L, durationMs);
        this.eqGains = eqGains == null ? null : eqGains.clone();
    }

    String canonicalId() {
        return id;
    }

    PlaybackCheckpointStore.SafeTrack toSafeCheckpointTrack() {
        return new PlaybackCheckpointStore.SafeTrack(
            id,
            title,
            artist,
            album,
            artwork,
            durationMs
        );
    }

    private static String valueOrDefault(String value, String fallback) {
        return value == null || value.isEmpty() ? fallback : value;
    }
}
