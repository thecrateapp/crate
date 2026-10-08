package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Before;
import org.junit.Test;

public class NativeInterruptionCoordinatorTest {
    private FakePlayback playback;
    private NativeInterruptionCoordinator coordinator;

    @Before
    public void setUp() {
        playback = new FakePlayback();
        coordinator = new NativeInterruptionCoordinator(playback);
    }

    @Test
    public void transientFocusLossCancelsPausesAndResumesOnGain() {
        playback.playing = true;

        coordinator.onFocusChange(
            NativeInterruptionCoordinator.FocusChange.TRANSIENT_LOSS
        );

        assertFalse(playback.playing);
        assertEquals(1, playback.cancellations);
        assertEquals(1, playback.checkpoints);
        assertTrue(coordinator.willResumeOnFocusGain());

        coordinator.onFocusChange(
            NativeInterruptionCoordinator.FocusChange.GAIN
        );

        assertTrue(playback.playing);
        assertEquals(1, playback.plays);
        assertFalse(coordinator.willResumeOnFocusGain());
    }

    @Test
    public void permanentFocusLossNeverResumesAutomatically() {
        playback.playing = true;

        coordinator.onFocusChange(
            NativeInterruptionCoordinator.FocusChange.LOSS
        );
        coordinator.onFocusChange(
            NativeInterruptionCoordinator.FocusChange.GAIN
        );

        assertFalse(playback.playing);
        assertEquals(0, playback.plays);
    }

    @Test
    public void duckAndGainOnlyChangeTheOutputMultiplier() {
        playback.playing = true;

        coordinator.onFocusChange(
            NativeInterruptionCoordinator.FocusChange.DUCK
        );
        assertEquals(0.2f, playback.duckMultiplier, 0.0001f);
        assertTrue(playback.playing);

        coordinator.onFocusChange(
            NativeInterruptionCoordinator.FocusChange.GAIN
        );
        assertEquals(1.0f, playback.duckMultiplier, 0.0001f);
        assertTrue(playback.playing);
    }

    @Test
    public void noisyRouteStopsBothDeckLifecycleWithoutAutoResume() {
        playback.playing = true;

        coordinator.onNoisyRoute();
        coordinator.onFocusChange(
            NativeInterruptionCoordinator.FocusChange.GAIN
        );

        assertFalse(playback.playing);
        assertEquals(1, playback.cancellations);
        assertEquals(1, playback.checkpoints);
        assertEquals(0, playback.plays);
    }

    private static final class FakePlayback
        implements NativeInterruptionCoordinator.Playback {
        boolean playing;
        int cancellations;
        int pauses;
        int plays;
        int checkpoints;
        float duckMultiplier = 1.0f;

        @Override
        public boolean isPlaying() {
            return playing;
        }

        @Override
        public void cancelTransition(String reason) {
            cancellations++;
        }

        @Override
        public void pause() {
            pauses++;
            playing = false;
        }

        @Override
        public void play() {
            plays++;
            playing = true;
        }

        @Override
        public void setDuckMultiplier(float multiplier) {
            duckMultiplier = multiplier;
        }

        @Override
        public void checkpoint() {
            checkpoints++;
        }
    }
}
