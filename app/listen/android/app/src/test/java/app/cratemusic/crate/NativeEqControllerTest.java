package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.HashMap;
import java.util.Map;

import org.junit.Test;

public class NativeEqControllerTest {
    @Test
    public void appliesTheSameUserEqToBothDeckSessions() {
        RecordingFactory factory = new RecordingFactory();
        NativeEqController controller = new NativeEqController(factory);

        boolean applied = controller.apply(
            true,
            new int[] { 101, 202 },
            new float[] { -2f, 1f, 3f, 0f, 0f, 0f, 0f, 0f, 0f, 0f }
        );

        assertTrue(applied);
        assertEquals(2, factory.effects.size());
        assertTrue(factory.effects.get(101).enabled);
        assertTrue(factory.effects.get(202).enabled);
        assertEquals(
            factory.effects.get(101).levels,
            factory.effects.get(202).levels
        );
    }

    @Test
    public void deckPromotionDoesNotRecreateOrLoseEitherEq() {
        RecordingFactory factory = new RecordingFactory();
        NativeEqController controller = new NativeEqController(factory);
        float[] gains = new float[] {
            1f, 1f, 1f, 1f, 1f, 1f, 1f, 1f, 1f, 1f
        };

        controller.apply(true, new int[] { 101, 202 }, gains);
        controller.apply(true, new int[] { 202, 101 }, gains);

        assertEquals(2, factory.creations);
        assertFalse(factory.effects.get(101).released);
        assertFalse(factory.effects.get(202).released);
    }

    @Test
    public void disablingEqReleasesBothDeckEffects() {
        RecordingFactory factory = new RecordingFactory();
        NativeEqController controller = new NativeEqController(factory);
        controller.apply(
            true,
            new int[] { 101, 202 },
            new float[] { 1f, 0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f }
        );

        controller.apply(false, new int[] { 101, 202 }, new float[10]);

        assertTrue(factory.effects.get(101).released);
        assertTrue(factory.effects.get(202).released);
    }

    private static final class RecordingFactory
        implements NativeEqController.EffectFactory {
        final Map<Integer, RecordingEffect> effects = new HashMap<>();
        int creations;

        @Override
        public NativeEqController.Effect create(int audioSessionId) {
            creations++;
            RecordingEffect effect = new RecordingEffect();
            effects.put(audioSessionId, effect);
            return effect;
        }
    }

    private static final class RecordingEffect
        implements NativeEqController.Effect {
        final Map<Short, Short> levels = new HashMap<>();
        boolean enabled;
        boolean released;

        @Override
        public short[] bandLevelRange() {
            return new short[] { -1500, 1500 };
        }

        @Override
        public short bandCount() {
            return 3;
        }

        @Override
        public int centerFrequencyHz(short band) {
            return new int[] { 32, 1000, 16000 }[band];
        }

        @Override
        public void setBandLevel(short band, short level) {
            levels.put(band, level);
        }

        @Override
        public void setEnabled(boolean requestedEnabled) {
            enabled = requestedEnabled;
        }

        @Override
        public void release() {
            released = true;
        }
    }
}
