package app.cratemusic.crate;

import androidx.media3.common.Player;

final class NativeForegroundPolicy {
    private NativeForegroundPolicy() {}

    static boolean shouldRunInForeground(boolean playWhenReady, int playbackState) {
        return playWhenReady && (
            playbackState == Player.STATE_READY ||
            playbackState == Player.STATE_BUFFERING
        );
    }
}
