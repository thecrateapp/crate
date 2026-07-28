package app.cratemusic.crate;

final class LegacyPlaybackContract {
    static final String ACTION_START = "app.cratemusic.crate.playback.START";
    static final String ACTION_UPDATE = "app.cratemusic.crate.playback.UPDATE";
    static final String ACTION_STOP_SERVICE = "app.cratemusic.crate.playback.STOP_SERVICE";
    static final String ACTION_PLAY = "app.cratemusic.crate.playback.PLAY";
    static final String ACTION_PAUSE = "app.cratemusic.crate.playback.PAUSE";
    static final String ACTION_NEXT = "app.cratemusic.crate.playback.NEXT";
    static final String ACTION_PREVIOUS = "app.cratemusic.crate.playback.PREVIOUS";

    static final String BROADCAST_CONTROL = "app.cratemusic.crate.playback.CONTROL";
    static final String EXTRA_CONTROL = "control";
    static final String EXTRA_POSITION = "position";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_ARTIST = "artist";
    static final String EXTRA_ALBUM = "album";
    static final String EXTRA_ARTWORK = "artwork";
    static final String EXTRA_IS_PLAYING = "isPlaying";
    static final String EXTRA_DURATION = "duration";
    static final String EXTRA_SUPPRESS_CONTROL = "suppressControl";

    private LegacyPlaybackContract() {}
}
