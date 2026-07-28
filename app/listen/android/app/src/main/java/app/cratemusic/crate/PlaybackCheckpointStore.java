package app.cratemusic.crate;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.Nullable;

import java.io.StringReader;
import java.io.StringWriter;
import java.net.URI;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Properties;

final class PlaybackCheckpointStore {
    private static final String PREFS_NAME = "crate_native_playback";
    private static final String CHECKPOINT_KEY = "safe_checkpoint_v1";

    static final class SafeTrack {
        final String id;
        final String title;
        final String artist;
        final String album;
        final String artwork;
        final long durationMs;

        SafeTrack(
            String id,
            String title,
            String artist,
            String album,
            String artwork,
            long durationMs
        ) {
            this.id = safeValue(id);
            this.title = safeValue(title);
            this.artist = safeValue(artist);
            this.album = safeValue(album);
            this.artwork = safeArtwork(artwork);
            this.durationMs = Math.max(0L, durationMs);
        }
    }

    static final class Checkpoint {
        final String revision;
        final List<SafeTrack> tracks;
        final int index;
        final long positionMs;
        final String repeat;
        final boolean playWhenReady;

        Checkpoint(
            String revision,
            List<SafeTrack> tracks,
            int index,
            long positionMs,
            String repeat,
            boolean playWhenReady
        ) {
            this.revision = safeValue(revision);
            this.tracks = Collections.unmodifiableList(
                new ArrayList<>(tracks == null ? Collections.emptyList() : tracks)
            );
            this.index = Math.max(0, index);
            this.positionMs = Math.max(0L, positionMs);
            this.repeat = safeValue(repeat);
            this.playWhenReady = playWhenReady;
        }
    }

    private final SharedPreferences preferences;

    PlaybackCheckpointStore(Context context) {
        preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    void save(Checkpoint checkpoint) {
        preferences.edit().putString(CHECKPOINT_KEY, serialize(checkpoint)).apply();
    }

    @Nullable
    Checkpoint load() {
        String raw = preferences.getString(CHECKPOINT_KEY, null);
        return raw == null || raw.isEmpty() ? null : deserialize(raw);
    }

    void clear() {
        preferences.edit().remove(CHECKPOINT_KEY).apply();
    }

    static String serialize(Checkpoint checkpoint) {
        Properties properties = new Properties();
        properties.setProperty("revision", checkpoint.revision);
        properties.setProperty("index", Integer.toString(checkpoint.index));
        properties.setProperty("positionMs", Long.toString(checkpoint.positionMs));
        properties.setProperty("repeat", checkpoint.repeat);
        properties.setProperty(
            "playWhenReady",
            Boolean.toString(checkpoint.playWhenReady)
        );
        properties.setProperty("trackCount", Integer.toString(checkpoint.tracks.size()));
        for (int index = 0; index < checkpoint.tracks.size(); index++) {
            SafeTrack track = checkpoint.tracks.get(index);
            String prefix = "track." + index + ".";
            properties.setProperty(prefix + "id", track.id);
            properties.setProperty(prefix + "title", track.title);
            properties.setProperty(prefix + "artist", track.artist);
            properties.setProperty(prefix + "album", track.album);
            properties.setProperty(prefix + "artwork", track.artwork);
            properties.setProperty(
                prefix + "durationMs",
                Long.toString(track.durationMs)
            );
        }
        try {
            StringWriter writer = new StringWriter();
            properties.store(writer, null);
            return writer.toString();
        } catch (Exception error) {
            return "";
        }
    }

    static Checkpoint deserialize(String raw) {
        Properties properties = new Properties();
        try {
            properties.load(new StringReader(raw == null ? "" : raw));
            int trackCount = boundedInt(properties.getProperty("trackCount"), 0, 10_000);
            List<SafeTrack> tracks = new ArrayList<>();
            for (int index = 0; index < trackCount; index++) {
                String prefix = "track." + index + ".";
                tracks.add(
                    new SafeTrack(
                        properties.getProperty(prefix + "id", ""),
                        properties.getProperty(prefix + "title", ""),
                        properties.getProperty(prefix + "artist", ""),
                        properties.getProperty(prefix + "album", ""),
                        properties.getProperty(prefix + "artwork", ""),
                        boundedLong(
                            properties.getProperty(prefix + "durationMs"),
                            0L
                        )
                    )
                );
            }
            return new Checkpoint(
                properties.getProperty("revision", ""),
                tracks,
                boundedInt(properties.getProperty("index"), 0, Math.max(0, trackCount - 1)),
                boundedLong(properties.getProperty("positionMs"), 0L),
                properties.getProperty("repeat", "off"),
                Boolean.parseBoolean(properties.getProperty("playWhenReady", "false"))
            );
        } catch (Exception error) {
            return new Checkpoint("", Collections.emptyList(), 0, 0L, "off", false);
        }
    }

    private static int boundedInt(String raw, int minimum, int maximum) {
        try {
            return Math.max(minimum, Math.min(maximum, Integer.parseInt(raw)));
        } catch (RuntimeException error) {
            return minimum;
        }
    }

    private static long boundedLong(String raw, long fallback) {
        try {
            return Math.max(0L, Long.parseLong(raw));
        } catch (RuntimeException error) {
            return fallback;
        }
    }

    private static String safeArtwork(String artwork) {
        String value = safeValue(artwork);
        if (value.isEmpty()) return "";
        try {
            URI uri = URI.create(value);
            if (uri.getScheme() == null) return value.split("\\?", 2)[0];
            return new URI(
                uri.getScheme(),
                uri.getAuthority(),
                uri.getPath(),
                null,
                null
            ).toString();
        } catch (Exception error) {
            return "";
        }
    }

    private static String safeValue(String value) {
        return value == null ? "" : value;
    }
}
