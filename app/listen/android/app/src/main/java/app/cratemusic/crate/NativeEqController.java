package app.cratemusic.crate;

import android.media.audiofx.Equalizer;
import android.util.Log;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

final class NativeEqController {
    private static final String TAG = "CrateNativeEq";
    private static final int[] CRATE_BANDS_HZ = new int[] {
        32,
        64,
        125,
        250,
        500,
        1000,
        2000,
        4000,
        8000,
        16000
    };

    interface EffectFactory {
        Effect create(int audioSessionId);
    }

    interface Effect {
        short[] bandLevelRange();

        short bandCount();

        int centerFrequencyHz(short band);

        void setBandLevel(short band, short level);

        void setEnabled(boolean enabled);

        void release();
    }

    private final EffectFactory effectFactory;
    private final Map<Integer, Effect> effects = new HashMap<>();

    NativeEqController() {
        this(SystemEffect::new);
    }

    NativeEqController(EffectFactory effectFactory) {
        if (effectFactory == null) {
            throw new IllegalArgumentException("EQ effect factory is required");
        }
        this.effectFactory = effectFactory;
    }

    boolean apply(
        boolean enabled,
        int[] audioSessionIds,
        float[] gains
    ) {
        if (!enabled || isFlat(gains)) {
            releaseAll();
            return false;
        }

        Set<Integer> desiredSessions = validSessions(audioSessionIds);
        releaseStale(desiredSessions);
        if (desiredSessions.isEmpty()) {
            return false;
        }

        boolean allApplied = true;
        for (int audioSessionId : desiredSessions) {
            Effect effect = effects.get(audioSessionId);
            try {
                if (effect == null) {
                    effect = effectFactory.create(audioSessionId);
                    effects.put(audioSessionId, effect);
                }
                applyGains(effect, gains);
                effect.setEnabled(true);
            } catch (RuntimeException error) {
                allApplied = false;
                release(audioSessionId, effect);
                Log.w(
                    TAG,
                    "System equalizer failed for audio session " +
                        audioSessionId,
                    error
                );
            }
        }
        return allApplied && effects.size() == desiredSessions.size();
    }

    void releaseAll() {
        for (Map.Entry<Integer, Effect> entry :
            new HashMap<>(effects).entrySet()) {
            release(entry.getKey(), entry.getValue());
        }
    }

    private void applyGains(Effect effect, float[] gains) {
        short[] range = effect.bandLevelRange();
        short minLevel = range != null && range.length > 0
            ? range[0]
            : -1500;
        short maxLevel = range != null && range.length > 1
            ? range[1]
            : 1500;
        short bandCount = effect.bandCount();
        for (short band = 0; band < bandCount; band++) {
            int crateBand = nearestCrateBand(
                effect.centerFrequencyHz(band)
            );
            float gainDb = gains != null && crateBand < gains.length
                ? gains[crateBand]
                : 0f;
            effect.setBandLevel(
                band,
                clampMillibels(
                    Math.round(gainDb * 100f),
                    minLevel,
                    maxLevel
                )
            );
        }
    }

    private void releaseStale(Set<Integer> desiredSessions) {
        for (Map.Entry<Integer, Effect> entry :
            new HashMap<>(effects).entrySet()) {
            if (!desiredSessions.contains(entry.getKey())) {
                release(entry.getKey(), entry.getValue());
            }
        }
    }

    private void release(int audioSessionId, Effect effect) {
        effects.remove(audioSessionId);
        if (effect == null) return;
        try {
            effect.setEnabled(false);
            effect.release();
        } catch (RuntimeException error) {
            Log.w(
                TAG,
                "Could not release EQ for audio session " + audioSessionId,
                error
            );
        }
    }

    private static Set<Integer> validSessions(int[] audioSessionIds) {
        Set<Integer> sessions = new HashSet<>();
        if (audioSessionIds == null) return sessions;
        for (int audioSessionId : audioSessionIds) {
            if (audioSessionId > 0) {
                sessions.add(audioSessionId);
            }
        }
        return sessions;
    }

    private static boolean isFlat(float[] gains) {
        if (gains == null || gains.length == 0) return true;
        for (float gain : gains) {
            if (Math.abs(gain) > 0.01f) return false;
        }
        return true;
    }

    private static int nearestCrateBand(int frequencyHz) {
        int bestIndex = 0;
        double bestDistance = Double.MAX_VALUE;
        double target = Math.log(Math.max(1, frequencyHz));
        for (int index = 0; index < CRATE_BANDS_HZ.length; index++) {
            double distance = Math.abs(
                Math.log(CRATE_BANDS_HZ[index]) - target
            );
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = index;
            }
        }
        return bestIndex;
    }

    private static short clampMillibels(
        int value,
        short minLevel,
        short maxLevel
    ) {
        return (short) Math.max(minLevel, Math.min(maxLevel, value));
    }

    @SuppressWarnings("deprecation")
    private static final class SystemEffect implements Effect {
        private final Equalizer equalizer;

        SystemEffect(int audioSessionId) {
            equalizer = new Equalizer(0, audioSessionId);
        }

        @Override
        public short[] bandLevelRange() {
            return equalizer.getBandLevelRange();
        }

        @Override
        public short bandCount() {
            return equalizer.getNumberOfBands();
        }

        @Override
        public int centerFrequencyHz(short band) {
            return Math.max(1, equalizer.getCenterFreq(band) / 1000);
        }

        @Override
        public void setBandLevel(short band, short level) {
            equalizer.setBandLevel(band, level);
        }

        @Override
        public void setEnabled(boolean enabled) {
            equalizer.setEnabled(enabled);
        }

        @Override
        public void release() {
            equalizer.release();
        }
    }
}
