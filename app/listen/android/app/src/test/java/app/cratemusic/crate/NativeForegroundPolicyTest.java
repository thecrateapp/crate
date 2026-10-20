package app.cratemusic.crate;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import androidx.media3.common.Player;

import org.junit.Test;

public class NativeForegroundPolicyTest {
    @Test
    public void bufferingWhilePlayingKeepsTheServiceInTheForeground() {
        assertTrue(NativeForegroundPolicy.shouldRunInForeground(true, Player.STATE_BUFFERING));
        assertTrue(NativeForegroundPolicy.shouldRunInForeground(true, Player.STATE_READY));
    }

    @Test
    public void pausedOrFinishedPlaybackLeavesTheForeground() {
        assertFalse(NativeForegroundPolicy.shouldRunInForeground(false, Player.STATE_READY));
        assertFalse(NativeForegroundPolicy.shouldRunInForeground(true, Player.STATE_ENDED));
        assertFalse(NativeForegroundPolicy.shouldRunInForeground(true, Player.STATE_IDLE));
    }
}
