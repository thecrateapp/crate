package app.cratemusic.crate;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import org.junit.Test;

public class PcmBusEqualizerTest {
    private static final int RATE = 48_000;

    private static float[] sine(double frequencyHz, int frames) {
        float[] samples = new float[frames * 2];
        for (int frame = 0; frame < frames; frame++) {
            float value = (float) (0.1 * Math.sin(2.0 * Math.PI * frequencyHz * frame / RATE));
            samples[frame * 2] = value;
            samples[frame * 2 + 1] = value;
        }
        return samples;
    }

    private static double tailGainDb(float[] before, float[] after) {
        double input = 0.0;
        double output = 0.0;
        for (int index = before.length / 2; index < before.length; index++) {
            input += before[index] * before[index];
            output += after[index] * after[index];
        }
        return 10.0 * Math.log10(output / input);
    }

    private static float[] gains(int band, float gainDb) {
        float[] gains = new float[PcmBusEqualizer.BANDS_HZ.length];
        gains[band] = gainDb;
        return gains;
    }

    @Test
    public void aFlatEqualizerLeavesTheMixUntouched() {
        PcmBusEqualizer equalizer = new PcmBusEqualizer(RATE, 2);
        equalizer.setGains(new float[PcmBusEqualizer.BANDS_HZ.length]);
        float[] samples = sine(1_000, 480);
        float[] original = samples.clone();

        equalizer.process(samples, 480);

        assertFalse(equalizer.isActive());
        assertArrayEquals(original, samples, 0.0f);
    }

    @Test
    public void aBandBoostsItsCenterFrequency() {
        PcmBusEqualizer equalizer = new PcmBusEqualizer(RATE, 2);
        equalizer.setGains(gains(5, 6.0f));
        float[] samples = sine(1_000, 9_600);
        float[] original = samples.clone();

        equalizer.process(samples, 9_600);

        assertEquals(6.0, tailGainDb(original, samples), 0.1);
    }

    @Test
    public void aLowBandLeavesTheMidrangeAlone() {
        PcmBusEqualizer equalizer = new PcmBusEqualizer(RATE, 2);
        equalizer.setGains(gains(0, 12.0f));
        float[] samples = sine(2_000, 9_600);
        float[] original = samples.clone();

        equalizer.process(samples, 9_600);

        assertEquals(0.0, tailGainDb(original, samples), 0.2);
    }

    @Test
    public void gainsAreClampedToTwelveDecibels() {
        PcmBusEqualizer equalizer = new PcmBusEqualizer(RATE, 2);
        equalizer.setGains(gains(5, 30.0f));
        float[] samples = sine(1_000, 9_600);
        float[] original = samples.clone();

        equalizer.process(samples, 9_600);

        assertEquals(12.0, tailGainDb(original, samples), 0.1);
    }
}
